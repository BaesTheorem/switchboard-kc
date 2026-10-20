// The city's MyCivic mobile API (api.mycivicapps.com/api/v3), the backend of
// the official myKCMO app. Each call is a multipart POST with an
// `ApiSignature` HS256 JWT signed with the key from the city's Android app.
// docs/API.md records the endpoints and fields.
//
// The key and API base live in KV ("civic:config"), so a new key takes
// effect without a deploy. A rejected signature marks the key "rejected";
// the web app then reads the new key from the newest APK (keys.js).

import { enc, b64url, b64urlText, HttpError, randomHex } from "./util.js";

export const API_VERSION = "6.0";
export const KANSAS_CITY = "1adb57d07d9ea1e1dd8160697f745c0d";
export const MENU_REPORT = "10871";
const DEFAULT_BASE = "https://api.mycivicapps.com/api/v3/";
const UA = "okhttp/4.9.0";
const NONCE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Per-isolate copy, so a burst of map calls reads KV once.
let memo = { cfg: undefined, at: 0 };
let keyState = { state: "", at: 0 };

export async function getConfig(env, fresh = false) {
  if (!fresh && memo.cfg !== undefined && Date.now() - memo.at < 60_000) return memo.cfg;
  let cfg = await env.KV.get("civic:config", fresh ? "json" : { type: "json", cacheTtl: 60 });
  if (!cfg && env.CIVIC_KEY) {
    cfg = { key: env.CIVIC_KEY, city_id: env.CITY_ID || KANSAS_CITY, app_version: env.APP_VERSION || "2025.020", source: "secret" };
  }
  if (cfg) {
    cfg.city_id ||= KANSAS_CITY;
    cfg.base_url ||= DEFAULT_BASE;
  }
  memo = { cfg: cfg || null, at: Date.now() };
  return memo.cfg;
}

export async function saveConfig(env, cfg, source) {
  const value = { key: cfg.key, city_id: cfg.city_id || KANSAS_CITY, app_version: cfg.app_version,
                  base_url: cfg.base_url || DEFAULT_BASE, source, updated: Date.now() };
  await env.KV.put("civic:config", JSON.stringify(value));
  memo = { cfg: value, at: Date.now() };
  await markKey(env, "ok");
  return value;
}

/** "ok" or "rejected", with when it was last set. Written only on a change. */
export async function markKey(env, state) {
  if (keyState.state === state) return;
  const prior = await env.KV.get("civic:state", "json");
  keyState = { state, at: Date.now() };
  if (prior?.state !== state) await env.KV.put("civic:state", JSON.stringify(keyState));
}

export async function readKeyState(env) {
  return (await env.KV.get("civic:state", { type: "json", cacheTtl: 60 })) || { state: "unknown", at: 0 };
}

async function signature(cfg, uid) {
  const nounce = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => NONCE[b % NONCE.length]).join("");
  const header = b64urlText(JSON.stringify({ alg: "HS256" }));
  const claims = b64urlText(JSON.stringify({
    city_id: cfg.city_id, deviceuid: uid, APPTYPE: "CITY", app_version: cfg.app_version,
    device_type: "android", APIVERSION: API_VERSION, nounce,
  }));
  const key = await crypto.subtle.importKey("raw", enc.encode(cfg.key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** Fields the Android app sends with almost every flat-part call. */
export function baseFields(cfg, uid) {
  return { city_id: cfg.city_id, api_version: API_VERSION, device_id: uid, deviceuid: uid, app_type: "1", language: "en" };
}

/**
 * One signed call. Returns { status, text }. A short body is checked for the
 * two auth failures: a bad signature ("Invalid API Signature", or "kindly
 * update the app") and response_code 403 (a moved base URL). Long bodies are
 * data and pass through unparsed, which keeps CPU time low.
 */
async function send(cfg, uid, endpoint, fields, files) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, typeof v === "string" ? v : JSON.stringify(v));
  for (const f of files) form.append(f.name, f.blob, f.filename);
  let r;
  try {
    r = await fetch(new URL(endpoint, cfg.base_url).toString(), {
      method: "POST", body: form, headers: { "User-Agent": UA, ApiSignature: await signature(cfg, uid) },
    });
  } catch {
    throw new HttpError(502, "city_offline", "No connection to the city's server.");
  }
  const text = await r.text();
  let auth = "";
  if (text.length < 4000) {
    try {
      const o = JSON.parse(text);
      const msg = String(o.response_token_message || "");
      if (/signature/i.test(msg) || /update the app/i.test(msg)) auth = "key";
      else if (Number(o.response_code) === 403) auth = "base";
    } catch { /* not JSON: an HTTP error page, handled by the caller */ }
  }
  return { status: r.status, text, auth };
}

/** Asks the city for its current API base, as the official app does after a 403. */
async function refreshBase(env, cfg, uid) {
  const form = new FormData();
  form.append("POST_JSON", JSON.stringify({ city_id: cfg.city_id, api_version: API_VERSION, deviceuid: uid, app_type: "CITY" }));
  try {
    const r = await fetch("https://api.mycivicapps.com/token/get_baseurl", {
      method: "POST", body: form, headers: { "User-Agent": UA, ApiSignature: await signature(cfg, uid) },
    });
    const main = (await r.json())?.response_data?.maindomainurl;
    if (!main) return false;
    const base = main.endsWith("/") ? main : `${main}/`;
    if (base === cfg.base_url) return false;
    await saveConfig(env, { ...cfg, base_url: base }, cfg.source || "base-refresh");
    return true;
  } catch {
    return false;
  }
}

/** A signed call with the stored key, repaired once after a 403. */
export async function civic(env, uid, endpoint, fields, files = []) {
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  let res = await send(cfg, uid, endpoint, fields, files);
  if (res.auth === "base" && (await refreshBase(env, cfg, uid))) {
    res = await send(await getConfig(env, true), uid, endpoint, fields, files);
  }
  if (res.auth === "key") {
    await markKey(env, "rejected");
    throw new HttpError(503, "key_rejected", "The city changed its app's API key.");
  }
  if (res.auth === "base") throw new HttpError(503, "city_refused", "The city's server refused the request.");
  if (keyState.state !== "ok" && res.status === 200) await markKey(env, "ok");
  return res;
}

export async function civicJSON(env, uid, endpoint, fields, files = []) {
  const res = await civic(env, uid, endpoint, fields, files);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new HttpError(502, "city_error", `The city's server returned an error (HTTP ${res.status}).`);
  }
}

/** True when the city accepts a signed read with this config. myissues for an unused id is the smallest reply. */
export async function accepts(cfg) {
  const uid = randomHex(8);
  const full = { ...cfg, base_url: cfg.base_url || DEFAULT_BASE };
  try {
    const res = await send(full, uid, "myissues", {
      POST_JSON: JSON.stringify({ city_id: full.city_id, api_version: API_VERSION, deviceuid: uid, device_id: uid, start: 0 }),
    }, []);
    if (res.auth) return false;
    const o = JSON.parse(res.text);
    return Array.isArray(o.my_issues);
  } catch {
    return false;
  }
}

// ---------- the reads the app needs ----------

/** All of this id's reports. The city pages them 20 at a time. */
export async function myReports(env, uid) {
  const cfg = await getConfig(env);
  const all = [];
  for (let start = 0, page = 0; page < 10; page++) {
    const o = await civicJSON(env, uid, "myissues", {
      POST_JSON: JSON.stringify({ city_id: cfg?.city_id || KANSAS_CITY, api_version: API_VERSION, deviceuid: uid, device_id: uid, start }),
    });
    const rows = o.my_issues || o.response_data?.my_issues || [];
    all.push(...rows);
    if (!rows.length || String(o.has_more) === "0" || !o.has_more) break;
    start += rows.length;
  }
  return all;
}

/**
 * One report's detail. "mine" uses get_issue_detail_citizen (the filer's
 * view, with the full timeline); "public" uses reported_issue_detail, the
 * endpoint the official app uses from the public list. Reporter contact
 * fields are removed here, whoever asks.
 */
export async function reportDetail(env, uid, id, scope = "mine") {
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  const endpoint = scope === "public" ? "reported_issue_detail" : "get_issue_detail_citizen";
  const o = await civicJSON(env, uid, endpoint, { ...baseFields(cfg, uid), issue_id: id });
  const issue = o.response_data?.issues?.[0];
  if (!issue) throw new HttpError(404, "not_available", o.response_message || "This report is not available.");
  for (const k of Object.keys(issue)) if (k.startsWith("reporter_")) delete issue[k];
  return issue;
}
