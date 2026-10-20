// Shared set-up for the browser tests. The tests run against a deployed
// server and read real city data, but they never file anything: every test
// page answers /api/submit, /api/push/* and the key download itself.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "../..");
const env = Object.fromEntries(readFileSync(join(web, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2)));

export const BASE = process.env.BASE_URL || env.URL;
export const OWNER = env.ADMIN_TOKEN;
/** A test reports id: random, so the tests never read or change a real person's list. */
export const TEST_DEVICE = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const ICONS = new Set(JSON.parse(readFileSync(join(web, "public/vendor/icons.json"), "utf8")));
export const KC = { latitude: 39.0997, longitude: -94.5786 };

/** A JPEG with an EXIF GPS block at lat/lng (degrees). */
export function jpegWithGps(lat, lng) {
  const base = readFileSync(join(web, "test/e2e/fixtures/photo.jpg"));
  const le = (n, b) => { const x = Buffer.alloc(b); b === 2 ? x.writeUInt16LE(n) : x.writeUInt32LE(n); return x; };
  const dms = (v) => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60 * 1000);
    return Buffer.concat([le(d, 4), le(1, 4), le(m, 4), le(1, 4), le(s, 4), le(1000, 4)]);
  };
  // TIFF header, IFD0 with one entry (GPS pointer), GPS IFD with four entries, then the rationals.
  const ifd0 = 8, gps = ifd0 + 2 + 12 + 4, gpsCount = 4, data = gps + 2 + gpsCount * 12 + 4;
  const entry = (tag, type, count, value) => Buffer.concat([le(tag, 2), le(type, 2), le(count, 4), value]);
  const ascii = (c) => Buffer.from([c.charCodeAt(0), 0, 0, 0]);
  const tiff = Buffer.concat([
    Buffer.from("II"), le(42, 2), le(ifd0, 4),
    le(1, 2), entry(0x8825, 4, 1, le(gps, 4)), le(0, 4),
    le(gpsCount, 2),
    entry(1, 2, 2, ascii(lat < 0 ? "S" : "N")), entry(2, 5, 3, le(data, 4)),
    entry(3, 2, 2, ascii(lng < 0 ? "W" : "E")), entry(4, 5, 3, le(data + 24, 4)), le(0, 4),
    dms(lat), dms(lng),
  ]);
  const body = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
}

/**
 * A page signed in as the owner, with a fresh test reports id and a KC
 * position. Returns { page, submits } where submits collects every report
 * the app tried to file.
 */
export async function ownerPage(context, { device = TEST_DEVICE, contact = null, duplicate = { level: "0", message: "" } } = {}) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(KC);
  await context.addInitScript(([owner, dev, c]) => {
    // Belt and braces: even if a mock below is bypassed, the server refuses to send a report to the city.
    localStorage.setItem("dryRun", "true");
    if (!localStorage.getItem("ownerToken")) localStorage.setItem("ownerToken", JSON.stringify(owner));
    if (!localStorage.getItem("deviceUID")) localStorage.setItem("deviceUID", JSON.stringify(dev));
    if (c && !localStorage.getItem("contact")) localStorage.setItem("contact", JSON.stringify(c));
  }, [OWNER, device, contact]);
  const page = await context.newPage();
  const submits = [];
  await page.route("**/api/submit", async (route) => {
    const body = route.request().postDataBuffer();
    const type = route.request().headers()["content-type"] || "";
    submits.push({ body, type });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "Report submitted", work_order: "123456" }) });
  });
  // The city's duplicate check is real data; tests that are not about it get "no duplicate".
  if (duplicate) await page.route("**/api/duplicate", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ...duplicate }) }));
  await page.route("**/api/push/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.route("**/api/key/**", (route) => route.fulfill({ status: 429, contentType: "application/json", body: '{"ok":false,"error":"test"}' }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.errors = errors;
  return { page, submits };
}

/** The issue_details JSON from a captured multipart submit. */
export function issueFrom(submit) {
  const text = submit.body.toString("latin1");
  const m = /name="issue_details"\r\n\r\n([\s\S]*?)\r\n--/.exec(text);
  return m ? JSON.parse(Buffer.from(m[1], "latin1").toString("utf8")) : null;
}

/** Runs axe-core and returns the serious and critical violations. */
export async function axe(page, include) {
  const src = readFileSync(join(web, "node_modules/axe-core/axe.min.js"), "utf8");
  // Evaluated, not added as a <script>: the app's CSP refuses inline scripts.
  await page.evaluate(src);
  const r = await page.evaluate(async (inc) => {
    // eslint-disable-next-line no-undef
    const res = await axe.run(inc ? { include: [inc] } : document, { resultTypes: ["violations"] });
    return res.violations.filter((v) => ["serious", "critical"].includes(v.impact))
      .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  }, include);
  return r;
}

/** Every icon name drawn on the page that the icon font does not have. */
export async function drawnIcons(page) {
  const names = await page.evaluate(() => [...document.querySelectorAll("i")].map((i) => i.textContent.trim()).filter(Boolean));
  return [...new Set(names)].filter((n) => !ICONS.has(n));
}
