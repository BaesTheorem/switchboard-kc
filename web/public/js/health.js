// Watches the city API and repairs it without the user (APIHealth.swift and
// KeyRefresher.swift). A check runs at launch and on foreground, at most every
// 6 hours. When the server says the city changed its key, this browser reads
// the new key from the city's newest Android app and gives the server the
// candidates to test (worker/keys.js explains why the browser does the scan).

import { api, authHeaders } from "./api.js";
import { emit } from "./state.js";
import { local } from "./lib/store.js";
import { readZip } from "./lib/zip.js";
import { banner, snack } from "./ui.js";

export const H = { status: "unknown", detail: null, repair: null, progress: null, lastCheck: local.get("healthAt", 0) };

export async function checkHealth(force = false) {
  if (!force && Date.now() - H.lastCheck < 6 * 3600e3 && H.status !== "unknown") return H;
  try {
    const o = await api("health?probe=1");
    H.status = o.ok ? "ok" : o.state;
    H.detail = o;
  } catch (e) {
    H.status = e.offline ? "offline" : "error";
  }
  H.lastCheck = Date.now();
  local.set("healthAt", H.lastCheck);
  emit("health");
  if (H.status === "rejected" || H.status === "no_key") onKeyTrouble(H.status);
  return H;
}

/** A rejected or missing key: repair it, at most once in 6 hours unless asked by hand. */
export function onKeyTrouble() {
  if (H.repair) return;
  if (Date.now() - local.get("keyAutoAt", 0) < 6 * 3600e3) return;
  local.set("keyAutoAt", Date.now());
  repairKey();
}

const KEY_RE = /(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{43}=(?![A-Za-z0-9+/=])/g;
const CITY_RE = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/g;
const VERSION_RE = /(?<![0-9.])20\d\d\.\d{3}(?![0-9.])/g;

/** Strings with the shape of the key, the city id, and the app version, from the APK's code files. */
export async function scanApk(bytes) {
  let files = await readZip(bytes, (n) => /^classes\d*\.dex$/.test(n));
  if (!files.size) {
    // An XAPK is a zip of split APKs; the code is in the base APK.
    for (const inner of (await readZip(bytes, (n) => n.endsWith(".apk"))).values()) {
      for (const [n, d] of await readZip(inner, (x) => /^classes\d*\.dex$/.test(x))) files.set(n, d);
    }
  }
  const keys = new Set(), cities = new Set(), versions = new Set();
  const dec = new TextDecoder("latin1");
  for (const dex of files.values()) {
    const s = dec.decode(dex);
    for (const m of s.matchAll(KEY_RE)) keys.add(m[0]);
    for (const m of s.matchAll(CITY_RE)) cities.add(m[0]);
    for (const m of s.matchAll(VERSION_RE)) versions.add(m[0]);
    await new Promise((r) => setTimeout(r));   // let the page breathe between files
  }
  return { keys: [...keys], cities: [...cities].slice(0, 20), versions: [...versions].sort().reverse() };
}

export async function repairKey(manual = false) {
  if (H.repair) return H.repair;
  H.repair = (async () => {
    try {
      H.progress = "Getting the city's current API key";
      banner(H.progress);
      emit("health");
      const r = await fetch("/api/key/apk", { headers: authHeaders() });
      if (!r.ok) {
        const o = await r.json().catch(() => ({}));
        throw new Error(o.message || `The server could not get the city's app (HTTP ${r.status}).`);
      }
      const total = Number(r.headers.get("content-length")) || 0;
      const reader = r.body.getReader();
      const chunks = [];
      let got = 0, lastPct = -1;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        const pct = total ? Math.floor((got / total) * 100) : -1;
        if (pct !== lastPct && pct % 5 === 0) {
          lastPct = pct;
          H.progress = total ? `Downloading the city's app, ${pct}%` : `Downloading the city's app, ${Math.round(got / 1e6)} MB`;
          banner(H.progress);
          emit("health");
        }
      }
      const bytes = new Uint8Array(got);
      let o = 0;
      for (const c of chunks) { bytes.set(c, o); o += c.length; }
      H.progress = "Reading the key";
      banner(H.progress);
      emit("health");
      const found = await scanApk(bytes);
      H.progress = "Testing the key";
      banner(H.progress);
      emit("health");
      const res = await api("key/candidates", { body: found });
      local.set("keyRefreshed", Date.now());
      H.status = "ok";
      H.lastCheck = 0;
      snack(`The city API key is updated (city app version ${res.app_version}).`);
      return true;
    } catch (e) {
      H.status = "broken";
      H.failure = e.message;
      if (manual) snack(e.message, 7000);
      return false;
    } finally {
      H.progress = null;
      banner(null);
      H.repair = null;
      emit("health");
    }
  })();
  return H.repair;
}
