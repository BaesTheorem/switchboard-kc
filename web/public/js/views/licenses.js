// Missouri license offices (driver licenses, plates, titles), nearest first,
// with today's hours. Missouri takes no appointments at these offices; they
// are walk-in, run by contractors for the Department of Revenue. The data is
// the state's own open dataset, the one the DOR office locator map reads
// (data.mo.gov 835g-7keg). It answers browsers directly (CORS). Ported from
// LicenseOffices.swift.

import { distance } from "../lib/format.js";
import { currentIfAllowed, DOWNTOWN, meters } from "../lib/geo.js";
import { bag, html, icon, on, render } from "../lib/html.js";
import { local } from "../lib/store.js";
import { str } from "../models.js";
import { acts, empty, label } from "../ui.js";
import { chip, dbl, directions, loadingRow, reason, refreshButton, telHref } from "./places.js";

const SOURCE = "https://data.mo.gov/resource/835g-7keg.json?$limit=1000";
const DAY = 86400e3;

// ---------- one office ----------

/** An office from one row of the state's data, or null when the row has no position. */
export function office(d) {
  const ll = d?.latlng;
  const lat = dbl(str(ll, "latitude"));
  const lng = dbl(str(ll, "longitude"));
  if (!ll || typeof ll !== "object" || lat == null || lng == null) return null;
  // The data stores ZIP+4 as nine bare digits ("641100000").
  const zip = str(d, "zipcode").slice(0, 5);
  return {
    id: str(d, "number"),
    name: str(d, "name"),
    address: [str(d, "address1"), str(d, "address2"), `${str(d, "city")}, MO ${zip}`].filter(Boolean).join(", "),
    phone: str(d, "phone"),
    hours: str(d, "daysopen").replaceAll("  ", " "),
    closedDays: [str(d, "holidaysclosed"), str(d, "additionaldaysclosed")].join(", "),
    lat,
    lng,
  };
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SPECIAL = ["last", "1st", "first", "except", "bus day"];

/** The weekdays (1 is Sunday) a run of text names. */
function dayset(t) {
  const found = DAYS
    .map((d, i) => [i + 1, t.indexOf(d)])
    .filter(([, at]) => at >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([n]) => n);
  // "monday - friday" (or "monday friday", a dash lost in the data) is a range.
  if (found.length === 2 && !t.includes(",")) {
    const range = new Set();
    for (let n = found[0]; n <= found[1]; n++) range.add(n);
    return range;
  }
  return new Set(found);
}

/**
 * Segments of "<days> H:MM-H:MM". Each one: the days it covers (empty when
 * the rule is special) and the minutes it opens and closes.
 */
export function segments(hours) {
  const s = String(hours).toLowerCase();
  const out = [];
  let from = 0;
  for (const m of s.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
    const dayText = s.slice(from, m.index);
    from = m.index + m[0].length;
    const n = (i) => Number(m[i]);
    const open = n(1) * 60 + n(2);
    // A close hour before the open hour, or at 7 or earlier, is in the afternoon.
    let closeHour = n(3);
    if (closeHour < n(1) || closeHour <= 7) closeHour += 12;
    const close = closeHour * 60 + n(4);
    const special = SPECIAL.some((w) => dayText.includes(w));
    out.push({ days: special ? new Set() : dayset(dayText), open, close });
  }
  return out;
}

/** The first segment that covers this weekday, or null. */
const span = (hours, weekday) => segments(hours).find((g) => g.days.has(weekday)) || null;

/** Minutes after midnight as "5 PM" or "4:30 PM". */
export function clock(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const half = h < 12 ? "AM" : "PM";
  return mm === 0 ? `${h12} ${half}` : `${h12}:${String(mm).padStart(2, "0")} ${half}`;
}

/**
 * Today's state from the free-text hours and closed days of an office
 * ({ hours, closedDays }), at `now` in the device's time zone:
 * { state: "open", until } | { state: "later", at } | { state: "closed" } |
 * { state: "early" } (closes early today) | { state: "unknown" }.
 * Special rules ("last Saturday", "bus day") are not computed; the raw text shows them.
 */
export function today(o, now = new Date()) {
  const closedDays = String(o.closedDays ?? "");
  const stamp = `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  const at = closedDays.indexOf(stamp);
  if (at >= 0) {
    const after = closedDays.slice(at + stamp.length, at + stamp.length + 25).toLowerCase();
    if (after.includes("partial")) return { state: "early" };
    return { state: "closed" };
  }
  const s = span(o.hours ?? "", now.getDay() + 1);
  if (!s) {
    // A special rule ("last Saturday") may cover today; say nothing rather than guess.
    const segs = segments(o.hours ?? "");
    if (!segs.length || segs.some((g) => !g.days.size)) return { state: "unknown" };
    return { state: "closed" };
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < s.open) return { state: "later", at: clock(s.open) };
  if (minutes < s.close) return { state: "open", until: clock(s.close) };
  return { state: "closed" };
}

// ---------- the saved list ----------

const saved = local.get("licenseOffices", []);
let offices = Array.isArray(saved) ? saved : [];
let error = null;
let running = null;

/** The list changes a few times a year, so a saved copy younger than a day is kept unless `force`. */
function load(force = false) {
  if (!force && offices.length && Date.now() - local.get("licenseOfficesSaved", 0) < DAY) return Promise.resolve();
  running ||= (async () => {
    try {
      const r = await fetch(SOURCE, { signal: globalThis.AbortSignal?.timeout?.(30000) });
      const rows = await r.json();
      const list = (Array.isArray(rows) ? rows : []).map(office).filter(Boolean);
      if (!list.length) throw new Error("The state's office list was empty.");
      offices = list;
      error = null;
      local.set("licenseOffices", list);
      local.set("licenseOfficesSaved", Date.now());
    } catch (e) {
      if (!offices.length) error = reason(e);
    } finally {
      running = null;
    }
  })();
  return running;
}

// ---------- the screen ----------

function status(t) {
  const s = t.state === "open" ? { glyph: icon("schedule"), words: `Open now, until ${t.until}`, tone: "done-text" }
    : t.state === "later" ? { glyph: icon("schedule"), words: `Opens today at ${t.at}`, tone: "open-text" }
    : t.state === "closed" ? { glyph: icon("block"), words: "Closed now", tone: "muted" }
    : t.state === "early" ? { glyph: icon("warning"), words: "Closes early today", tone: "open-text" }
    : null;
  return s ? html`<p class="today caption strong ${s.tone}">${s.glyph}<span>${s.words}</span></p>` : "";
}

function row(o, m) {
  return html`<li class="place stack s4">
    <div class="row base">
      <h3 class="headline grow">${o.name}</h3>
      <span class="caption muted mono">${distance(m)}</span>
    </div>
    ${status(today(o))}
    <p class="caption muted">${o.address}</p>
    <p class="caption muted">${o.hours}</p>
    <div class="chips">
      ${o.phone && telHref(o.phone) ? chip(telHref(o.phone), icon("call"), "Call", { about: o.name }) : ""}
      ${chip(directions(o.lat, o.lng, o.name), icon("directions"), "Directions", { external: true, about: o.name })}
    </div>
  </li>`;
}

export default function licensesView(main) {
  let here = null;
  let dead = false;

  render(main, html`<div class="screen city-ui stack s20">
    <section class="stack s8">
      <div class="rows">
        <a class="item" href="https://mydmv.mo.gov" target="_blank" rel="noopener">
          ${icon("badge")}<span class="grow">MyDMV: renew a license, schedule a driving test</span>${icon("open_in_new", "trail")}
        </a>
        <a class="item" href="https://dor.mo.gov/motor-vehicle/plates/" target="_blank" rel="noopener">
          ${icon("directions_car")}<span class="grow">Renew plates online</span>${icon("open_in_new", "trail")}
        </a>
      </div>
      <p class="foot muted">Missouri license offices are walk-in and take no appointments. Driving tests are booked with the Highway Patrol through MyDMV.</p>
    </section>
    <section class="stack s8" data-list></section>
    ${refreshButton()}
  </div>`);

  const paint = () => {
    const el = main.querySelector("[data-list]");
    if (dead || !el) return;
    const c = here || DOWNTOWN;
    const near = offices.map((o) => [o, meters(c, o)]).sort((a, b) => a[1] - b[1]).slice(0, 25);
    render(el, html`
      ${label(here ? "Nearest to you" : "Nearest to downtown")}
      ${offices.length ? "" : html`<div class="rows">${error
        ? empty({ icon: "cloud_off", title: "Cannot load the offices", message: error, action: { label: "Try again", attr: "data-retry" } })
        : loadingRow("Loading the offices")}</div>`}
      ${near.length ? html`<ul class="rows">${near.map(([o, m]) => row(o, m))}</ul>` : ""}`);
  };

  const refresh = async (force) => {
    paint();
    await load(force);
    paint();
  };

  paint();
  (async () => {
    here = await currentIfAllowed();
    await refresh(false);
  })();

  const add = bag();
  add(
    acts(main, { refresh: () => refresh(true) }),
    on(main, "click", "[data-retry]", () => { error = null; refresh(true); }),
  );
  return () => { dead = true; add.run(); };
}
