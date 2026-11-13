// Ticket alerts for the web app (Web Push, RFC 8030/8291/8292).
//
// The browser subscribes with this server's VAPID public key and sends the
// subscription with its reports id. A cron reads each id's reports every
// minute and pushes new timeline entries, with these rules:
// - An update request is never reported on its own. What staff do with it
//   goes out under the report it names. The request itself is the person's
//   own act, and gets no alert.
// - The first look at an id records what exists and sends nothing.
// - State is saved only after a push is accepted, so a failure retries.
//
// The subscriptions and what the cron saw last are rows in the ledger's
// SQLite (alerts-store.js). A run asks the ledger for the ids of this minute
// and gives it back the rows that changed: two calls, and no KV. The two KV
// values of the first version (wpush:subs, wpush:state) are read one time,
// to move their content, and nothing reads them after that.
// None of it holds report text, addresses, or contact data.
//
// The same run asks a device to send an update request for a report that is
// due (asks.js).

import { buildPushPayload } from "@block65/webcrypto-web-push";
import { askMessage, deviceFor, dueReports, makeTicket, TICKET_LIFE, toAsk } from "./asks.js";
import { ledger } from "./auth.js";
import { myReports, reportDetail } from "./civic.js";
import { b64url, deviceId, HttpError, json } from "./util.js";

const UPDATE_TEXT = "Please send an update on";
// Push services the browsers use. The Worker sends nowhere else.
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
                    /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/];

// ---------- VAPID ----------

let vapidMemo = null;   // the keys never change, and the app asks for the public one at each start

/** The server's VAPID keys, made once and kept in KV. */
export async function vapid(env) {
  if (vapidMemo) return vapidMemo;
  const kept = await vapidFromKV(env);
  vapidMemo = kept;
  return kept;
}

async function vapidFromKV(env) {
  let v = await env.KV.get("cfg:vapid", { type: "json", cacheTtl: 3600 });
  if (v) return v;
  v = await env.KV.get("cfg:vapid", "json");
  if (v) return v;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  v = { publicKey: b64url(raw), privateKey: jwk.d };
  await env.KV.put("cfg:vapid", JSON.stringify(v));
  return v;
}

// ---------- subscribe ----------

function checkSubscription(s) {
  let host = "";
  try {
    const u = new URL(String(s?.endpoint || ""));
    if (u.protocol !== "https:") throw new Error();
    host = u.hostname;
  } catch {
    throw new HttpError(400, "bad_subscription", "The push subscription has no valid endpoint.");
  }
  if (!PUSH_HOSTS.some((re) => re.test(host))) throw new HttpError(400, "bad_subscription", "Unknown push service.");
  if (!s.keys?.p256dh || !s.keys?.auth) throw new HttpError(400, "bad_subscription", "The push subscription has no keys.");
  return { endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) }, added: Date.now() };
}

export async function subscribe(env, b) {
  const uid = deviceId(b.device);
  // `auto`: the device keeps filled update requests and sends one when this server asks (asks.js).
  const sub = { ...checkSubscription(b.subscription), auto: b.auto === true };
  // Read the id's reports once: this checks the city key and that the id works.
  await myReports(env, uid);
  const store = ledger(env);
  await moveFromKV(env, store);
  // A changed reports id (Settings > Restore) moves the subscription: `previous` is the id it had.
  const prior = /^[0-9a-f]{16}$/.test(String(b.previous || "")) ? String(b.previous) : "";
  await store.alertSubscribe(uid, sub, prior);
  return json({ ok: true });
}

export async function unsubscribe(env, b) {
  const uid = deviceId(b.device);
  const store = ledger(env);
  await moveFromKV(env, store);
  await store.alertUnsubscribe(uid, String(b.endpoint || ""));
  return json({ ok: true });
}

let moved = false;   // in this isolate

/** One time: moves the two KV values of the first version into the ledger. */
async function moveFromKV(env, store, known = false) {
  if (moved || known) { moved = true; return; }
  const [subs, state] = await Promise.all([env.KV.get("wpush:subs", "json"), env.KV.get("wpush:state", "json")]);
  await store.alertImport(subs || {}, state || {});
  moved = true;
}

/** Sends one message to every subscription of an id. Returns the endpoints the push service says are gone. `ttl` is how long the push service keeps it for a device that is off, in seconds. */
async function send(env, subs, message, ttl = 6 * 3600) {
  const keys = await vapid(env);
  const v = { subject: env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey: keys.publicKey, privateKey: keys.privateKey };
  const gone = [];
  let ok = 0;
  for (const s of subs) {
    try {
      const payload = await buildPushPayload({ data: JSON.stringify(message), options: { ttl, urgency: "normal", topic: message.tag?.slice(0, 32) } }, s, v);
      const r = await fetch(s.endpoint, payload);
      if (r.status === 404 || r.status === 410) gone.push(s.endpoint);
      else if (r.ok) ok++;
    } catch {
      // A bad subscription must not stop the others.
    }
  }
  return { ok, gone };
}

export async function test(env, b) {
  const uid = deviceId(b.device);
  const store = ledger(env);
  await moveFromKV(env, store);
  const subs = await store.alertSubs(uid);
  if (!subs.length) throw new HttpError(404, "no_subscription", "Alerts are not on for this reports id.");
  const r = await send(env, subs, { title: "Alerts work", body: "You will get a notification when the city changes one of your reports.", tag: "test", url: "/#/reports" });
  return json({ ok: r.ok > 0, sent: r.ok });
}

// ---------- the cron ----------

function caseNumber(r) {
  let tp = r.thirdparty_params || {};
  if (typeof tp === "string") { try { tp = tp ? JSON.parse(tp) : {}; } catch { tp = {}; } }
  return tp && typeof tp === "object" && tp.case_number ? String(tp.case_number) : "";
}

const isUpdateRequest = (r) =>
  String(r.name || r.issue_type || "").toLowerCase().includes("request update")
  || String(r.description || "").trim().startsWith(UPDATE_TEXT);

function requestsFor(report, mine) {
  const cn = caseNumber(report);
  const keys = [`report ${report.id}`, ...(cn ? [`#${cn}`] : [])];
  return mine.filter((r) => isUpdateRequest(r) && keys.some((k) => String(r.description || "").includes(k)));
}

const OWN_REQUEST = "Update requested";
const sig = (rows) => rows.map((r) => `${r.id}:${r.status}|${r.updated_on}`).sort().join(",");
/** The part of a signature that staff change: each report's status. The update time is left out. */
export const statusPart = (s) => String(s || "").split(",").map((x) => x.split("|")[0]).join(",");
/**
 * Minutes between two looks at the timeline of a report whose update time moves and whose status does not.
 * The city's own sync writes a new update time each minute to some open reports (a "Missed Trash" report on
 * 2026-11-10: 835 minutes in sequence). One timeline read each minute for such a report is too much.
 */
export const QUIET = 15;

/** True when the run must read the report's timeline: its signature is new, and a move of only the update time waits QUIET minutes. */
export function mustLook(prior, s, minute) {
  if (!prior) return true;
  if (prior.sig === s) return false;
  if (statusPart(prior.sig) !== statusPart(s)) return true;
  return minute - (prior.at || 0) >= QUIET;
}
const entryKey = (e) => `${Math.floor(e.at)}|${e.title}`;
const entries = (d, prefix = "") =>
  (d.history_object || []).map((h) => ({ at: Number(h.timestamp || 0), title: prefix + String(h.title || ""), details: String(h.details || "").replace(/<[^>]+>/g, "").trim() }));

async function timeline(env, uid, report, requests) {
  const rows = entries(await reportDetail(env, uid, report.id));
  for (const q of requests) {
    const d = await reportDetail(env, uid, q.id);
    rows.push({ at: Number(d.added_on || 0), title: OWN_REQUEST, details: `Update request ${q.id}` });
    rows.push(...entries(d, `Update request ${q.id}: `));
  }
  return rows.sort((a, b) => a.at - b.at);
}

function message(report, fresh) {
  const label = String(report.subcategory || report.sub_type || report.name || "311 report").replace(/\s{2,}/g, ", ");
  const last = fresh[fresh.length - 1];
  const more = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "";
  return {
    title: `${label}: now ${report.status}`,
    body: `${last.title}${last.details ? `: ${last.details}` : ""}${more}`.slice(0, 400),
    tag: `report-${report.id}`,
    url: `/#/reports/mine/${report.id}`,
  };
}

/**
 * One minute's pass. The ledger gives the ids of this minute (at most 15, so a
 * run stays under the free plan's 50 calls out) with what was seen, and gets
 * back only the reports that changed.
 */
export async function poll(env, when = Date.now()) {
  const store = ledger(env);
  const minute = Math.floor(when / 60000);
  let turn = await store.alertBatch(minute);
  if (!turn.imported) {
    await moveFromKV(env, store);
    turn = await store.alertBatch(minute);
  }
  moved = true;
  if (!turn.batch.length) return [];
  const updates = [];
  const gone = [];
  const asks = [];
  const results = [];
  for (const { uid, subs, seeded, seen, asked } of turn.batch) {
    const changed = {};
    try {
      const all = await myReports(env, uid);
      for (const report of all) {
        if (isUpdateRequest(report)) continue;
        const requests = requestsFor(report, all);
        const s = sig([report, ...requests]);
        const prior = seen[report.id];
        if (!mustLook(prior, s, minute)) continue;
        const tl = await timeline(env, uid, report, requests);
        const known = new Set(prior?.keys || []);
        // An update request that the person (or their device) sent is not news to them. What staff do with it is.
        const fresh = tl.filter((e) => !known.has(entryKey(e)) && e.title !== OWN_REQUEST);
        if (fresh.length && seeded && prior) {
          const r = await send(env, subs, message(report, fresh));
          gone.push(...r.gone.map((endpoint) => [uid, endpoint]));
          if (!r.ok) continue;   // keep the old state: the next run tries again
        }
        changed[report.id] = { sig: s, keys: [...new Set([...known, ...tl.map(entryKey)])].slice(-200), at: minute };
      }
      // The first look records what exists and sends nothing.
      if (!seeded || Object.keys(changed).length) updates.push({ uid, seen: changed });
      // One ask in a run for an id: its device sends the update request for a report that is due (asks.js).
      const device = seeded ? deviceFor(subs, when) : null;
      const due = device ? toAsk(dueReports(all, when), asked, when)[0] : null;
      let askedNow = 0;
      if (due) {
        const exp = when + TICKET_LIFE;
        const ticket = await makeTicket((await vapid(env)).privateKey, uid, due.id, due.caseNumber, exp);
        const r = await send(env, [device], askMessage(due, ticket), TICKET_LIFE / 1000);
        gone.push(...r.gone.map((endpoint) => [uid, endpoint]));
        if (r.ok) { asks.push({ uid, report: due.id, at: when, exp }); askedNow = 1; }
      }
      results.push({ uid: uid.slice(0, 4), reports: all.length, ...(askedNow ? { asked: askedNow } : {}) });
    } catch (e) {
      results.push({ uid: uid.slice(0, 4), error: String(e.code || e.message || e) });
      if (e.code === "key_rejected" || e.code === "no_key") break;
    }
  }
  if (updates.length || gone.length || asks.length) await store.alertSave(updates, gone, asks);
  return results;
}
