// Ticket alerts for the web app (Web Push, RFC 8030/8291/8292).
//
// The browser subscribes with this server's VAPID public key and sends the
// subscription with its reports id. A cron reads each id's reports every
// minute and pushes new timeline entries, the same rules as push/worker.js
// for the iPhone app:
// - An update request is never reported on its own. Its activity goes out
//   under the report it names.
// - The first look at an id records what exists and sends nothing.
// - State is saved only after a push is accepted, so a failure retries.
//
// KV holds two values, so one cron run costs two reads:
//   wpush:subs   { uid: [ {endpoint, keys, added} ] }  written by (un)subscribe
//   wpush:state  { uid: { seeded, seen: { reportId: {sig, keys} } } }  written by the cron
// Neither holds report text, addresses, or contact data.

import { buildPushPayload } from "@block65/webcrypto-web-push";
import { myReports, reportDetail } from "./civic.js";
import { b64url, deviceId, HttpError, json } from "./util.js";

const UPDATE_TEXT = "Please send an update on";
// Push services the browsers use. The Worker sends nowhere else.
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
                    /(^|\.)notify\.windows\.com$/, /^android\.googleapis\.com$/];

// ---------- VAPID ----------

/** The server's VAPID keys, made once and kept in KV. */
export async function vapid(env) {
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
  const sub = checkSubscription(b.subscription);
  // Read the id's reports once: this checks the city key and that the id works.
  await myReports(env, uid);
  const subs = (await env.KV.get("wpush:subs", "json")) || {};
  const prior = b.previous ? String(b.previous) : "";
  // A changed reports id (Settings > Restore) moves the subscription.
  if (prior && prior !== uid && subs[prior]) {
    subs[prior] = subs[prior].filter((x) => x.endpoint !== sub.endpoint);
    if (!subs[prior].length) delete subs[prior];
  }
  subs[uid] = [...(subs[uid] || []).filter((x) => x.endpoint !== sub.endpoint), sub].slice(-5);
  await env.KV.put("wpush:subs", JSON.stringify(subs));
  return json({ ok: true });
}

export async function unsubscribe(env, b) {
  const uid = deviceId(b.device);
  const subs = (await env.KV.get("wpush:subs", "json")) || {};
  const before = subs[uid]?.length || 0;
  subs[uid] = (subs[uid] || []).filter((x) => x.endpoint !== String(b.endpoint || ""));
  if (!subs[uid].length) delete subs[uid];
  if ((subs[uid]?.length || 0) !== before) await env.KV.put("wpush:subs", JSON.stringify(subs));
  return json({ ok: true });
}

/** Sends one message to every subscription of an id. Returns the endpoints the push service says are gone. */
async function send(env, subs, message) {
  const keys = await vapid(env);
  const v = { subject: env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey: keys.publicKey, privateKey: keys.privateKey };
  const gone = [];
  let ok = 0;
  for (const s of subs) {
    try {
      const payload = await buildPushPayload({ data: JSON.stringify(message), options: { ttl: 6 * 3600, urgency: "normal", topic: message.tag?.slice(0, 32) } }, s, v);
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
  const subs = ((await env.KV.get("wpush:subs", "json")) || {})[uid] || [];
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

const sig = (rows) => rows.map((r) => `${r.id}:${r.status}|${r.updated_on}`).sort().join(",");
const entryKey = (e) => `${Math.floor(e.at)}|${e.title}`;
const entries = (d, prefix = "") =>
  (d.history_object || []).map((h) => ({ at: Number(h.timestamp || 0), title: prefix + String(h.title || ""), details: String(h.details || "").replace(/<[^>]+>/g, "").trim() }));

async function timeline(env, uid, report, requests) {
  const rows = entries(await reportDetail(env, uid, report.id));
  for (const q of requests) {
    const d = await reportDetail(env, uid, q.id);
    rows.push({ at: Number(d.added_on || 0), title: "Update requested", details: `Update request ${q.id}` });
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

/** One minute's pass. Ids are split into slices so each run stays under the free plan's 50 subrequests. */
export async function poll(env, when = Date.now()) {
  const subs = (await env.KV.get("wpush:subs", "json")) || {};
  const uids = Object.keys(subs).sort();
  if (!uids.length) return [];
  const slices = Math.ceil(uids.length / 15);
  const minute = Math.floor(when / 60000);
  const mine = uids.filter((_, i) => i % slices === minute % slices);
  const state = (await env.KV.get("wpush:state", "json")) || {};
  let changed = false;
  const gone = [];
  const results = [];
  for (const uid of mine) {
    const st = state[uid] || { seeded: false, seen: {} };
    try {
      const all = await myReports(env, uid);
      for (const report of all) {
        if (isUpdateRequest(report)) continue;
        const requests = requestsFor(report, all);
        const s = sig([report, ...requests]);
        const prior = st.seen[report.id];
        if (prior && prior.sig === s) continue;
        const tl = await timeline(env, uid, report, requests);
        const known = new Set(prior?.keys || []);
        const fresh = tl.filter((e) => !known.has(entryKey(e)));
        if (fresh.length && st.seeded && prior) {
          const r = await send(env, subs[uid], message(report, fresh));
          gone.push(...r.gone.map((endpoint) => [uid, endpoint]));
          if (!r.ok) continue;   // keep the old state: the next run tries again
        }
        st.seen[report.id] = { sig: s, keys: [...new Set([...known, ...tl.map(entryKey)])].slice(-200) };
        changed = true;
      }
      if (!st.seeded) { st.seeded = true; changed = true; }
      state[uid] = st;
      results.push({ uid: uid.slice(0, 4), reports: all.length });
    } catch (e) {
      results.push({ uid: uid.slice(0, 4), error: String(e.code || e.message || e) });
      if (e.code === "key_rejected" || e.code === "no_key") break;
    }
  }
  if (changed) await env.KV.put("wpush:state", JSON.stringify(state));
  if (gone.length) {
    const fresh = (await env.KV.get("wpush:subs", "json")) || {};
    for (const [uid, endpoint] of gone) {
      fresh[uid] = (fresh[uid] || []).filter((x) => x.endpoint !== endpoint);
      if (!fresh[uid].length) delete fresh[uid];
    }
    await env.KV.put("wpush:subs", JSON.stringify(fresh));
  }
  return results;
}
