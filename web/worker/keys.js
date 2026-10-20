// Keeps the city API key current without a computer.
//
// The key ships inside the city's Android app (com.civicapps.kansascitymo).
// The heavy work, unzipping the APK and scanning its code for key-shaped
// strings, needs more CPU time than a free Worker has, so the browser does it:
//   1. GET  /api/key/apk         this Worker finds the newest APK on APKPure and
//                                streams it to the browser (no CORS there).
//   2. the browser unzips the classes*.dex files and finds candidates.
//   3. POST /api/key/candidates  this Worker tests each combination against the
//                                city and saves the first one the city accepts.
// A candidate can only be saved if the city accepts it, so a bad client can
// at worst waste a few test calls.

import { accepts, getConfig, KANSAS_CITY, saveConfig } from "./civic.js";
import { HttpError, json } from "./util.js";

const PACKAGE = "com.civicapps.kansascitymo";
const APK_EVERY = 6 * 3600 * 1000;

/** The APK link from APKPure's app_version reply (protobuf; the link follows an "APKJ" marker). */
async function apkLink() {
  const r = await fetch(`https://api.pureapk.com/m/v3/cms/app_version?hl=en-US&package_name=${PACKAGE}`, {
    headers: { "x-cv": "3172501", "x-sv": "29", "x-abis": "arm64-v8a,armeabi-v7a,armeabi,x86,x86_64", "x-gp": "1" },
  });
  if (!r.ok) throw new HttpError(502, "apk_lookup", "Could not find the city app's download.");
  const bytes = new Uint8Array(await r.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const m = /APKJ[\s\S]{1,4}?(https?:\/\/[-a-zA-Z0-9@:%._+~#=/?&()]+)/.exec(text);
  if (!m) throw new HttpError(502, "apk_lookup", "Could not find the city app's download.");
  return m[1];
}

/** Streams the newest APK. At most once in 6 hours, except for the owner. */
export async function relayApk(env, admin) {
  const last = Number(await env.KV.get("key:apk_at")) || 0;
  if (!admin && Date.now() - last < APK_EVERY) {
    const state = await env.KV.get("civic:state", "json");
    // A fresh rejection after the last download is a reason to look again.
    if (!(state?.state === "rejected" && state.at > last)) {
      throw new HttpError(429, "apk_recent", "The key was checked recently. Try again later.");
    }
  }
  await env.KV.put("key:apk_at", String(Date.now()));
  const r = await fetch(await apkLink());
  if (!r.ok || !r.body) throw new HttpError(502, "apk_download", "The city app's download failed.");
  const headers = { "content-type": "application/octet-stream", "cache-control": "no-store" };
  const len = r.headers.get("content-length");
  if (len) headers["content-length"] = len;
  return new Response(r.body, { headers });
}

const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const CITY_RE = /^[0-9a-f]{32}$/;
const VERSION_RE = /^20\d\d\.\d{3}$/;

export async function testCandidates(env, b) {
  const keys = [...new Set((b.keys || []).filter((k) => KEY_RE.test(k)))].slice(0, 6);
  const cities = [...new Set([KANSAS_CITY, ...(b.cities || []).filter((c) => CITY_RE.test(c))])].slice(0, 4);
  const versions = [...new Set((b.versions || []).filter((v) => VERSION_RE.test(v)))].sort().reverse().slice(0, 3);
  if (!keys.length) throw new HttpError(400, "no_candidates", "No key-shaped strings were found in the city app.");
  const current = await getConfig(env);
  if (!versions.length) versions.push(current?.app_version || "2025.020");
  let tried = 0;
  for (const key of keys) {
    for (const app_version of versions) {
      for (const city_id of cities) {
        if (++tried > 40) break;
        const cfg = { key, city_id, app_version, base_url: current?.base_url };
        if (await accepts(cfg)) {
          const saved = await saveConfig(env, cfg, "apk");
          return json({ ok: true, app_version: saved.app_version, tried });
        }
      }
    }
  }
  return json({ ok: false, error: "not_accepted", message: "The city did not accept any key from its app. It may have changed how requests are signed.", tried }, 422);
}

/** The owner can set the key directly (bin/set-key, or the Mac's key watcher). */
export async function setKey(env, b) {
  const cfg = { key: String(b.key || ""), city_id: String(b.city_id || KANSAS_CITY), app_version: String(b.app_version || "") };
  if (!KEY_RE.test(cfg.key) || !CITY_RE.test(cfg.city_id) || !VERSION_RE.test(cfg.app_version)) {
    throw new HttpError(400, "bad_key", "key, city_id and app_version do not have the right shape.");
  }
  if (!(await accepts(cfg))) throw new HttpError(422, "not_accepted", "The city did not accept this key.");
  const saved = await saveConfig(env, cfg, b.source || "owner");
  return json({ ok: true, app_version: saved.app_version });
}
