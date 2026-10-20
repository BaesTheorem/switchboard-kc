// RideKC buses and the streetcar: the stops nearest you and their next
// scheduled departures, from KCATA's static GTFS feed (free to use; about
// 1.9 MB, saved for a week). Live arrivals need a Swiftly API key, which the
// app does not have yet, so times are the schedule. The feed sends no CORS
// headers, so it comes through this app's server (/api/open/gtfs). A worker
// (workers/gtfs.js) reads it, so the page does not freeze. Ported from
// Transit.swift.

import { authHeaders } from "../api.js";
import { clockFromSeconds, distance } from "../lib/format.js";
import { currentIfAllowed, DOWNTOWN } from "../lib/geo.js";
import { bag, html, icon, render } from "../lib/html.js";
import { idb } from "../lib/store.js";
import { acts } from "../ui.js";
import { loadingRow, reason, refreshButton } from "./places.js";

const WEEK = 7 * 86400e3;

/** The feed's zip bytes: the saved copy when younger than a week, else a new download. */
async function feed() {
  const saved = await idb.get("gtfs");
  if (saved?.bytes && Date.now() - saved.at < WEEK) return saved.bytes;
  const r = await fetch("/api/open/gtfs", { headers: authHeaders() });
  if (!r.ok) {
    const o = await r.json().catch(() => null);
    throw new Error(o?.message || `The server returned an error (HTTP ${r.status}).`);
  }
  const bytes = await r.arrayBuffer();
  // Save only a real zip ("PK"), so a bad download is not kept for a week.
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error("The download is not a zip file.");
  await idb.set("gtfs", { at: Date.now(), bytes });
  return bytes;
}

/** `#/city/transit?hour=H` checks the schedule as if it were H:00 today (screenshots and tests). */
function scheduleTime() {
  const now = new Date();
  const h = new URLSearchParams(location.hash.split("?")[1] || "").get("hour");
  if (/^\d{1,2}$/.test(h || "") && Number(h) < 24) now.setHours(Number(h), 0, 0, 0);
  return now.getTime();
}

const stopSection = (s) => html`<section class="stack s8">
  <h2 class="label row"><span class="grow">${s.name}</span><span class="mono">${distance(s.meters)}</span></h2>
  ${s.departures.length
    ? html`<ul class="rows">${s.departures.map((d) => html`<li class="cell">
        <span class="route"><span class="visually-hidden">Route </span>${d.route}</span>
        <span class="grow sub clamp2">${d.headsign}</span>
        <span class="sub muted mono">${clockFromSeconds(d.seconds)}</span>
      </li>`)}</ul>`
    : html`<div class="rows"><p class="cell caption muted">No departures in the next two hours.</p></div>`}
</section>`;

export default function transitView(main) {
  let stops = null;
  let error = null;
  let dead = false;
  let busy = false;
  let worker = null;

  render(main, html`<div class="screen city-ui stack s20">
    <div class="rows">
      <p class="cell sub muted">RideKC buses and the KC Streetcar near you. Times are the published schedule, not live arrivals.</p>
      <a class="item" href="https://ridekc.org" target="_blank" rel="noopener">
        <span class="grow primary-text">RideKC trip planner and alerts</span>${icon("open_in_new", "trail")}
      </a>
    </div>
    <div class="stack s20" data-list></div>
    ${refreshButton()}
  </div>`);

  const paint = () => {
    const el = main.querySelector("[data-list]");
    if (dead || !el) return;
    render(el, error ? html`<div class="rows"><p class="cell caption error-text">Could not load the schedule: ${error}</p></div>`
      : !stops ? html`<div class="rows">${loadingRow("Loading the schedule")}</div>`
      : html`${stops.length ? "" : html`<div class="rows"><p class="cell muted">No stops within half a mile.</p></div>`}
        ${stops.map(stopSection)}`);
  };

  /** Runs the worker once. Resolves to the stops; the worker stops when it answers. */
  const read = (zip, here, now) => new Promise((resolve, reject) => {
    const w = new Worker(new URL("../workers/gtfs.js", import.meta.url), { type: "module" });
    worker = w;
    const done = () => { w.terminate(); if (worker === w) worker = null; };
    w.onmessage = (e) => {
      done();
      if (e.data?.error) reject(new Error(e.data.error));
      else resolve(e.data?.stops || []);
    };
    w.onerror = (e) => { done(); reject(new Error(e.message || "The schedule reader did not start.")); };
    w.onmessageerror = () => { done(); reject(new Error("The schedule reader did not answer.")); };
    w.postMessage({ zip, here, now });
  });

  const load = async () => {
    if (busy) return;
    busy = true;
    try {
      const here = (await currentIfAllowed()) || DOWNTOWN;
      stops = await read(await feed(), here, scheduleTime());
      error = null;
    } catch (e) {
      // A failed refresh keeps the stops it already shows.
      if (!stops) error = reason(e);
    } finally {
      busy = false;
    }
    paint();
  };

  paint();
  load();
  const add = bag();
  add(acts(main, { refresh: () => load() }));
  return () => {
    dead = true;
    worker?.terminate();
    add.run();
  };
}
