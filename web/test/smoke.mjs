#!/usr/bin/env node
// Read-only smoke test of a deployed server: config, health, the catalog, my
// reports, one detail, one map group, the duplicate check, and the guards
// (a bad origin, a bad device id). It files nothing.
//   node test/smoke.mjs [base-url]
// Uses ADMIN_TOKEN from web/.env (the owner may call everything) and the
// device id in ../ios/Config/civic-config.json when present (else a new one).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(web, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const base = process.argv[2] || env.URL || "https://switchboard-kc.alex-hedtke.workers.dev";
const cfgPath = join(web, "../ios/Config/civic-config.json");
const device = (existsSync(cfgPath) && JSON.parse(readFileSync(cfgPath, "utf8")).device_uid) || "0123456789abcdef";
const owner = { "x-admin-token": env.ADMIN_TOKEN, "content-type": "application/json" };

let failed = 0;
async function check(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    console.log(`ok   ${name} (${Date.now() - t} ms)${note ? `: ${note}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
const post = (path, body, headers = owner) => fetch(`${base}/api/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const ok = async (r) => { const o = await r.json(); if (!r.ok || o.ok === false) throw new Error(`${r.status} ${o.error}: ${o.message}`); return o; };

let mine = [];
let cats = [];
await check("config", async () => { const o = await ok(await fetch(`${base}/api/config`, { headers: owner })); if (!o.admin) throw new Error("owner token not accepted"); return `mode ${o.mode}`; });
await check("health", async () => { const o = await ok(await fetch(`${base}/api/health?probe=1`)); return `${o.state}, app ${o.key?.app_version}`; });
await check("catalog", async () => {
  const o = await ok(await fetch(`${base}/api/catalog`, { headers: owner }));
  cats = o.tables.RAI_CATEGORY;
  return `${cats.length} categories, ${o.tables.RAI_SUBCATEGORY.length} sub-types, ${o.tables.MENU.length} links`;
});
await check("myissues", async () => { mine = (await ok(await post("myissues", { device }))).my_issues; return `${mine.length} reports`; });
await check("detail (mine)", async () => {
  if (!mine.length) return "no reports to read";
  const o = await ok(await post("detail", { device, id: mine[0].id, scope: "mine" }));
  if (Object.keys(o.issue).some((k) => k.startsWith("reporter_"))) throw new Error("reporter fields leaked");
  return `${(o.issue.history_object || []).length} timeline entries, no reporter fields`;
});
let pin = null;
await check("map (one group of 5)", async () => {
  const names = cats.slice(0, 5).map((c) => c.name);
  const r = await post("map", { device, lat: 39.0997, lng: -94.5786, status: "open", types: names });
  if (r.status === 502) return "the city answered HTTP 500 for this mix (the app splits it)";
  const o = await r.json();
  const rows = o.response_status?.response_data || [];
  pin = rows[0];
  return `${rows.length} pins`;
});
await check("detail (public)", async () => {
  if (!pin) return "no pin";
  const o = await ok(await post("detail", { device, id: pin.report_id, scope: "public" }));
  if (Object.keys(o.issue).some((k) => k.startsWith("reporter_"))) throw new Error("reporter fields leaked");
  return `status ${o.issue.status}`;
});
await check("duplicate check", async () => {
  const pot = cats.find((c) => /pothole/i.test(c.name));
  const o = await ok(await post("duplicate", { device, payload: { latitude: "39.0937", longitude: "-94.5340", address: "4131 E Truman Rd", city: "Kansas City", state: "MO", zip: "64127", type: pot.cat_id, subtype: "44019" } }));
  return `level ${o.level}`;
});
await check("open: a visitor with no token can read", async () => {
  const r = await post("myissues", { device }, { "content-type": "application/json" });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
});
await check("guard: another site's origin is refused", async () => {
  const r = await post("myissues", { device }, { ...owner, origin: "https://evil.example" });
  if (r.status !== 403) throw new Error(`HTTP ${r.status}`);
});
await check("guard: a bad device id is refused", async () => {
  const r = await post("myissues", { device: "../../etc" });
  if (r.status !== 400) throw new Error(`HTTP ${r.status}`);
});
await check("guard: a point outside KC is refused", async () => {
  const r = await post("map", { device, lat: 40.7, lng: -74, status: "open", types: ["Trash"] });
  if (r.status !== 400) throw new Error(`HTTP ${r.status}`);
});
await check("guard: a report for another city id is refused", async () => {
  const f = new FormData();
  f.append("device", device);
  f.append("issue_details", JSON.stringify({ city_id: "x", menu_id: "10871", deviceuid: device, device_id: device }));
  const r = await fetch(`${base}/api/submit`, { method: "POST", headers: { "x-admin-token": env.ADMIN_TOKEN }, body: f });
  if (r.status !== 400) throw new Error(`HTTP ${r.status}`);
});
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
