// startup.js: the start-time record behind Settings > Details.

import assert from "node:assert/strict";
import test from "node:test";

const kept = new Map();
globalThis.localStorage = {
  getItem: (k) => (kept.has(k) ? kept.get(k) : null),
  setItem: (k, v) => { kept.set(k, String(v)); },
  removeItem: (k) => { kept.delete(k); },
};
const { recordStart, seconds, startLog, startParts } = await import("../../public/js/startup.js");

const perf = (page, files = []) => ({
  getEntriesByType: (type) => (type === "navigation" ? [{ responseStart: page }] : files),
});

test("startParts says where the time of a start went", () => {
  assert.equal(startParts({ page: 100, files: 500, id: 550, saved: 600, screen: 700 }), "page 0.1 s · files 0.4 s · storage 0.1 s · first screen 0.1 s");
  assert.equal(startParts(null), "");
});

test("startParts leaves out a part that the browser did not time", () => {
  assert.equal(startParts({ page: null, files: 500, id: 550, saved: 600, screen: 700 }), "storage 0.1 s · first screen 0.1 s");
});

test("recordStart keeps the last start and names the slowest file", () => {
  kept.clear();
  const rec = recordStart({ files: 410.4, id: 450, saved: 470, screen: 520.6 },
    perf(90.2, [{ name: "https://example.org/js/app.js", duration: 120 }, { name: "https://example.org/css/app.css", duration: 310 }]));
  assert.deepEqual({ page: rec.page, files: rec.files, id: rec.id, saved: rec.saved, screen: rec.screen }, { page: 90, files: 410, id: 450, saved: 470, screen: 521 });
  assert.equal(rec.slowFile, "/css/app.css 0.3 s");
  assert.equal(startLog().last.screen, 521);
  assert.equal(startLog().slowest, null);
});

test("recordStart keeps a slow start until a slower one comes", () => {
  kept.clear();
  recordStart({ files: 117000, id: 117500, saved: 117800, screen: 118000 }, perf(300));
  recordStart({ files: 400, id: 450, saved: 470, screen: 520 }, perf(90));
  assert.equal(startLog().last.screen, 520);
  assert.equal(startLog().slowest.screen, 118000);
  recordStart({ files: 6000, id: 6100, saved: 6200, screen: 6300 }, perf(90));
  assert.equal(startLog().slowest.screen, 118000);
  recordStart({ files: 130000, id: 130100, saved: 130200, screen: 130300 }, perf(90));
  assert.equal(startLog().slowest.screen, 130300);
});

test("seconds shows one decimal", () => {
  assert.equal(seconds(118040), "118.0 s");
  assert.equal(seconds(49), "0.0 s");
});
