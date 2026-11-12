// How long the app took to start, kept on this device for Settings > Details.
// A slow start cannot be studied afterward without numbers from the device
// that had it: which part was slow (the page, the files, storage, the first
// screen). Nothing here leaves the device.

import { local } from "./lib/store.js";

const SLOW = 5000;   // ms: a start this slow is kept as the slowest one
const ms = (n) => (Number.isFinite(n) ? Math.round(n) : null);

/**
 * Saves one start. `marks` holds ms since the page began to load: `files`
 * (every script is in), `id` (the reports id is read from storage), `saved`
 * (the saved catalog, queue and pins are read), `screen` (the first screen).
 */
export function recordStart(marks, perf = globalThis.performance) {
  const nav = perf?.getEntriesByType?.("navigation")?.[0];
  const files = perf?.getEntriesByType?.("resource") || [];
  const worst = files.reduce((a, b) => (b.duration > (a?.duration ?? 0) ? b : a), null);
  const rec = {
    at: Date.now(),
    page: ms(nav?.responseStart),
    files: ms(marks.files), id: ms(marks.id), saved: ms(marks.saved), screen: ms(marks.screen),
    slowFile: worst ? `${worst.name.replace(/^https?:\/\/[^/]+/, "")} ${seconds(worst.duration)}` : null,
    installed: globalThis.matchMedia?.("(display-mode: standalone)").matches || globalThis.navigator?.standalone === true,
  };
  local.set("startLast", rec);
  const slowest = local.get("startSlowest");
  if (rec.screen >= SLOW && rec.screen > (slowest?.screen ?? 0)) local.set("startSlowest", rec);
  return rec;
}

export const startLog = () => ({ last: local.get("startLast"), slowest: local.get("startSlowest") });

export const seconds = (n) => `${(n / 1000).toFixed(1)} s`;

/** Where the time of one start went, part by part: "page 0.1 s · files 0.4 s · storage 0.1 s · first screen 0.1 s". */
export function startParts(rec) {
  if (!rec) return "";
  const step = (to, from) => (to == null || from == null ? null : seconds(Math.max(0, to - from)));
  return [["page", step(rec.page, 0)], ["files", step(rec.files, rec.page)], ["storage", step(rec.saved, rec.files)], ["first screen", step(rec.screen, rec.saved)]]
    .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(" · ");
}
