// KC 311 push: tells a phone within a minute when the city touches one of its
// 311 reports. The app registers its MyCivic device id and APNs token; a cron
// reads each device's reports every minute and sends new timeline entries.
//
// The city's own records are the state source. KV keeps, per device, the push
// token and which timeline entries were already sent. It is written only when
// something changes, so the free plan's 1,000 writes a day are plenty.
//
// Rules:
// - An update request is never reported on its own. Its activity goes out
//   under the report it names, with the request's entries merged in by time.
// - The first look at a device records what exists and sends nothing.
// - State is saved only after the push is accepted, so a failure retries.

const API_VERSION = "6.0";
const UPDATE_TEXT = "Please send an update on";
const DEVICES = "devices";

// ---------- encoding ----------

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(enc.encode(s));
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

// ---------- city API ----------

class KeyRejected extends Error {}

async function civicSignature(env, deviceUid) {
  const header = b64urlText(JSON.stringify({ alg: "HS256" }));
  const claims = b64urlText(JSON.stringify({
    city_id: env.CITY_ID, deviceuid: deviceUid, APPTYPE: "CITY", app_version: env.APP_VERSION,
    device_type: "android", APIVERSION: API_VERSION, nounce: hex(8),
  }));
  const key = await crypto.subtle.importKey("raw", enc.encode(env.CIVIC_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

async function civicPost(env, deviceUid, endpoint, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  const r = await fetch(`${env.BASE_URL}${endpoint}`, {
    method: "POST", body: form,
    headers: { "User-Agent": "okhttp/4.9.0", ApiSignature: await civicSignature(env, deviceUid) },
  });
  const data = await r.json();
  // A bad key shows as 403 "Signature Verification Failed" or as response
  // code 1 with "Invalid API Signature".
  if (String(data.response_token_message || "").includes("Signature")) throw new KeyRejected(data.response_token_message);
  return data;
}

async function myReports(env, uid) {
  const body = { city_id: env.CITY_ID, api_version: API_VERSION, deviceuid: uid, device_id: uid, start: 0 };
  const data = await civicPost(env, uid, "myissues", { POST_JSON: JSON.stringify(body) });
  return data.my_issues || data.response_data?.my_issues || [];
}

async function reportDetail(env, uid, id) {
  const data = await civicPost(env, uid, "get_issue_detail_citizen", {
    city_id: env.CITY_ID, api_version: API_VERSION, device_id: uid, deviceuid: uid, app_type: "1", language: "en", issue_id: id,
  });
  const issue = data.response_data?.issues?.[0];
  if (!issue) throw new Error(`no detail for ${id}`);
  return issue;
}

// ---------- the shared rules ----------

function caseNumber(r) {
  let tp = r.thirdparty_params || {};
  if (typeof tp === "string") { try { tp = tp ? JSON.parse(tp) : {}; } catch { tp = {}; } }
  return tp && typeof tp === "object" && tp.case_number ? String(tp.case_number) : "";
}

const isUpdateRequest = (r) =>
  String(r.name || r.issue_type || "").toLowerCase().includes("311 request update")
  || String(r.description || "").trim().startsWith(UPDATE_TEXT);

function updateRequestsFor(report, mine) {
  const cn = caseNumber(report);
  const keys = [`report ${report.id}`, ...(cn ? [`#${cn}`, cn] : [])];
  return mine.filter((r) => isUpdateRequest(r) && keys.some((k) => String(r.description || "").includes(k)));
}

const sig = (rows) => rows.map((r) => `${r.id}:${r.status}|${r.updated_on}`).sort().join(",");
const entryKey = (e) => `${Math.floor(e.at)}|${e.title}`;

function entries(detail, prefix = "") {
  return (detail.history_object || []).map((h) => ({
    at: Number(h.timestamp || 0), title: prefix + String(h.title || ""), details: String(h.details || "").trim(),
  }));
}

async function mergedTimeline(env, uid, report, requests) {
  const rows = entries(await reportDetail(env, uid, report.id));
  for (const req of requests) {
    const rd = await reportDetail(env, uid, req.id);
    // This endpoint's added_on is the real time; myissues' runs hours ahead.
    rows.push({ at: Number(rd.added_on || 0), title: "Update requested", details: `Update request ${req.id}` });
    rows.push(...entries(rd, `Update request ${req.id}: `));
  }
  return rows.sort((a, b) => a.at - b.at);
}

// ---------- APNs ----------

let apnsJwt = { token: "", iat: 0 };

async function apnsToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwt.token && now - apnsJwt.iat < 40 * 60) return apnsJwt.token;   // Apple: refresh 20-60 min
  const pem = env.APNS_KEY.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64urlText(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
  const body = b64urlText(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: now }));
  const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  apnsJwt = { token: `${head}.${body}.${b64url(sigBuf)}`, iat: now };
  return apnsJwt.token;
}

/** Returns "ok", "gone" (token dead: forget the device) or "retry: <why>". */
async function push(env, dev, payload, threadId) {
  const host = dev.env === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const r = await fetch(`https://${host}/3/device/${dev.token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${await apnsToken(env)}`, "apns-topic": env.APNS_TOPIC, "apns-push-type": "alert",
      "apns-priority": "10", "apns-collapse-id": `report-${threadId}`.slice(0, 64), "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (r.ok) return "ok";
  const reason = (await r.json().catch(() => ({}))).reason || "";
  return r.status === 410 || ["BadDeviceToken", "Unregistered"].includes(reason) ? "gone" : `retry: apns ${r.status} ${reason}`;
}

function message(report, fresh) {
  const label = report.subcategory || report.sub_type || report.name || "311 report";
  const last = fresh[fresh.length - 1];
  const more = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : "";
  return {
    aps: {
      alert: { title: label, subtitle: `Now ${report.status}`, body: `${last.title}${last.details ? `: ${last.details}` : ""}${more}` },
      sound: "default", "thread-id": `report-${report.id}`,
    },
    report_id: String(report.id),
  };
}

// ---------- one device ----------

async function checkDevice(env, uid) {
  const dev = await env.KV.get(`dev:${uid}`, "json");
  if (!dev) return { uid: uid.slice(0, 6), skipped: "unknown" };
  const mine = await myReports(env, uid);
  const seen = dev.seen || {};
  const first = !dev.seeded;
  let changed = first;
  let sent = 0;
  const failed = [];
  for (const report of mine) {
    if (isUpdateRequest(report)) continue;
    const requests = updateRequestsFor(report, mine);
    const s = sig([report, ...requests]);
    const prior = seen[report.id];
    if (prior && prior.sig === s) continue;
    const timeline = await mergedTimeline(env, uid, report, requests);
    const known = new Set(prior?.keys || []);
    const fresh = timeline.filter((e) => !known.has(entryKey(e)));
    if (fresh.length && !first && prior) {
      const result = await push(env, dev, message(report, fresh), report.id);
      if (result === "gone") return forget(env, uid, "token rejected");
      if (result !== "ok") { failed.push(result); continue; }   // keep the old state; the next run sends again
      sent += 1;
    }
    seen[report.id] = { sig: s, keys: [...new Set([...known, ...timeline.map(entryKey)])] };
    changed = true;
  }
  if (changed) await env.KV.put(`dev:${uid}`, JSON.stringify({ ...dev, seen, seeded: true }));
  return { uid: uid.slice(0, 6), reports: mine.length, sent, ...(failed.length ? { error: failed.join("; ") } : {}) };
}

async function forget(env, uid, why) {
  await env.KV.delete(`dev:${uid}`);
  const list = (await env.KV.get(DEVICES, "json")) || [];
  await env.KV.put(DEVICES, JSON.stringify(list.filter((u) => u !== uid)));
  return { uid: uid.slice(0, 6), forgotten: why };
}

// ---------- entry points ----------

async function runAll(env) {
  const list = (await env.KV.get(DEVICES, "json")) || [];
  const results = [];
  for (const uid of list) {
    try { results.push(await checkDevice(env, uid)); }
    catch (e) { results.push({ uid: uid.slice(0, 6), error: e instanceof KeyRejected ? "civic key rejected" : String(e.message || e) }); }
  }
  console.log(JSON.stringify(results));
  // Written only when a run had an error or sent something: KV writes are the scarce resource.
  if (results.some((r) => r.error || r.sent)) await env.KV.put("last_run", JSON.stringify({ at: Date.now(), results }));
  return results;
}

const json = (obj, status = 200) => Response.json(obj, { status });

async function register(env, req) {
  const b = await req.json().catch(() => ({}));
  const uid = String(b.device_uid || "");
  const token = String(b.token || "").toLowerCase();
  const apnsEnv = b.env === "sandbox" ? "sandbox" : "production";
  if (!/^[A-Za-z0-9-]{8,80}$/.test(uid) || !/^[0-9a-f]{64,200}$/.test(token)) return json({ ok: false, error: "bad device_uid or token" }, 400);
  // Read the id's reports once: this checks the city key, and records what
  // exists. It does not prove the id is real; the city answers an unknown id
  // with an empty list. The device id is the secret, here as in the city API.
  try { await myReports(env, uid); } catch (e) { return json({ ok: false, error: String(e.message || e) }, 502); }
  const prior = (await env.KV.get(`dev:${uid}`, "json")) || {};
  await env.KV.put(`dev:${uid}`, JSON.stringify({ ...prior, token, env: apnsEnv, registered: Date.now() }));
  const list = (await env.KV.get(DEVICES, "json")) || [];
  if (!list.includes(uid)) await env.KV.put(DEVICES, JSON.stringify([...list, uid]));
  const result = prior.seeded ? { reports: "kept" } : await checkDevice(env, uid);
  return json({ ok: true, ...result, uid: undefined });
}

async function unregister(env, req) {
  const b = await req.json().catch(() => ({}));
  const uid = String(b.device_uid || "");
  const dev = await env.KV.get(`dev:${uid}`, "json");
  // Only the holder of the push token can remove a device.
  if (!dev || dev.token !== String(b.token || "").toLowerCase()) return json({ ok: false }, 404);
  await forget(env, uid, "unregistered");
  return json({ ok: true });
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method === "POST" && pathname === "/register") return register(env, req);
    if (req.method === "POST" && pathname === "/unregister") return unregister(env, req);
    // Runs the cron pass now and returns its result. For debugging; needs ADMIN_TOKEN.
    if (req.method === "POST" && pathname === "/run" && env.ADMIN_TOKEN
        && req.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`) return json(await runAll(env));
    if (pathname === "/health") {
      const list = (await env.KV.get(DEVICES, "json")) || [];
      return json({ ok: true, devices: list.length, last_run: await env.KV.get("last_run", "json") });
    }
    return json({ ok: false }, 404);
  },

  async scheduled(_event, env) { await runAll(env); },
};
