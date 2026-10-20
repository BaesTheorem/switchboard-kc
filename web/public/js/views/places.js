// Basic needs around the user, from open civic data: shelters and cooling and
// warming centers, stores that take SNAP, health centers, benefits offices,
// and housing counselors, nearest first. Every source was checked on
// 2026-10-06; none needs a key or a login. Ported from CivicData.swift
// (PlacesView, CivicSources, BasicNeeds).
//
// The ArcGIS layers and data.mo.gov answer browsers directly (CORS). HUD's
// counselor list does not, so it comes through this app's server
// (/api/open/hud). The health centers are a file shipped with the app.

import { authHeaders } from "../api.js";
import { attrs, point, query, text } from "../lib/arcgis.js";
import { distance } from "../lib/format.js";
import { currentIfAllowed, DOWNTOWN, meters } from "../lib/geo.js";
import { bag, html, icon, render, safeUrl } from "../lib/html.js";
import { acts, empty, label } from "../ui.js";

// ---------- shared with licenses.js and transit.js ----------

/** Swift's Double(String): null for empty or malformed text. */
export function dbl(s) {
  const t = String(s ?? "").trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
}

const CASED = /\p{Cased}/u;
const IGNORABLE = /\p{Case_Ignorable}/u;

/**
 * Foundation's `capitalized`: the first letter of each word upper case, the
 * rest lower case. A word starts after any character that is not a letter or
 * case-ignorable (an apostrophe or a period does not start one), so
 * "NACA COUNSELING" becomes "Naca Counseling", as on the iPhone.
 */
export function capitalized(s) {
  let out = "";
  let inWord = false;
  for (const ch of String(s ?? "")) {
    out += inWord ? ch.toLowerCase() : ch.toUpperCase();
    inWord = CASED.test(ch) || (inWord && IGNORABLE.test(ch));
  }
  return out;
}

/**
 * A tel: link: the digits of the number. An extension ("417-451-9450 x207")
 * is dialed after a pause, so it does not run into the number.
 */
export function telHref(phone) {
  const s = String(phone ?? "").trim();
  const m = /^(.*?)\s*(?:ext\.?|x)\s*(\d+)$/i.exec(s);
  const digits = (m ? m[1] : s).replace(/\D/g, "");
  return digits ? `tel:${digits}${m ? `,${m[2]}` : ""}` : "";
}

/** Directions to a point. maps.apple.com opens Google Maps on Android. */
export const directions = (lat, lng, name = "") =>
  `https://maps.apple.com/?daddr=${lat},${lng}${name ? `&q=${encodeURIComponent(name)}` : ""}`;

/**
 * A small action chip. `glyph` is an icon("...") call, so the icon font build
 * finds the name. `about` adds the place name for screen readers.
 */
export function chip(href, glyph, words, { external = false, about = "" } = {}) {
  const more = about ? html`<span class="visually-hidden">, ${about}</span>` : "";
  return external
    ? html`<a class="chip-s tap" href="${safeUrl(href)}" target="_blank" rel="noopener">${glyph}<span>${words}</span>${more}</a>`
    : html`<a class="chip-s tap" href="${safeUrl(href)}">${glyph}<span>${words}</span>${more}</a>`;
}

/** Why a load failed, in plain words (the iPhone shows the system's description). */
export function reason(e) {
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return "The request timed out.";
  if (e instanceof TypeError && /fetch|load failed|network/i.test(e.message)) {
    return globalThis.navigator?.onLine === false ? "No internet connection." : "The server did not answer.";
  }
  if (e instanceof SyntaxError) return "The answer was not in the expected format.";
  return e?.message || String(e);
}

/** A list row with a small spinner, for a list that is still loading. */
export const loadingRow = (words) => html`<div class="cell loading" role="status">
  <progress class="circle small" aria-hidden="true"></progress><span class="visually-hidden">${words}</span>
</div>`;

/** The web's pull-to-refresh: a button at the end of the page. */
export const refreshButton = () => html`<button class="btn tonal refresh" type="button" data-act="refresh">${icon("refresh")}<span>Refresh</span></button>`;

/** Fetch with a time limit. */
const get = (url, init = {}) => fetch(url, { ...init, signal: globalThis.AbortSignal?.timeout?.(30000) });

/** The server's own words for a failed call to /api. */
async function problem(r) {
  const o = await r.json().catch(() => null);
  return o?.message || `The server returned an error (HTTP ${r.status}).`;
}

// ---------- sources ----------

// A place: { id, title, lines, phone, web, lat, lng, badge, hidden }.
// `hidden` keeps the address and directions out of sight (confidential shelters).

const BEDS = "https://maps2.kcmo.org/kcgis/rest/services/Data_Layers/BedInventory/FeatureServer/1";
const DHSS = "https://gis.mo.gov/arcgis/rest/services/DHSS";
const SNAP = "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/snap_retailer_location_data/FeatureServer/0";
const FSD = "https://data.mo.gov/resource/dsx5-5mwh.json?$limit=500";

export async function shelters() {
  const out = [];
  for (const f of await query(BEDS)) {
    const a = attrs(f);
    const type = text(a, "USER_ProjectType");
    if (!(type.startsWith("ES") || type.startsWith("SH") || type.startsWith("TH"))) continue;
    const kind = type.startsWith("ES") ? "Emergency shelter" : type.startsWith("SH") ? "Safe haven" : "Transitional housing";
    const confidential = text(a, "USER_VictimServiceProvider") === "Yes";
    const p = point(f);
    const beds = text(a, "USER_CurrentBedInventory");
    const lines = [kind + (beds ? ` · ${beds} beds` : "")];
    const who = text(a, "USER_HouseholdTargetPopulation").replace(/^[A-Z]+ - /, "");
    if (who) lines.push(`For: ${who}`);
    lines.push(confidential ? "Confidential location for survivors of violence. Call 211 for intake." : text(a, "USER_ProjectAddress"));
    out.push({
      id: `bed-${text(a, "OBJECTID")}`, title: text(a, "USER_ProjectName"), lines,
      phone: confidential ? "211" : null,
      lat: confidential ? null : p?.lat ?? null, lng: confidential ? null : p?.lng ?? null,
      badge: type.startsWith("ES") ? "Shelter" : null, hidden: confidential,
    });
  }
  return out;
}

/** Cooling or Warming centers within 30 miles, from the state health department. */
export async function centers(kind, c) {
  return (await query(`${DHSS}/${kind}_Center/MapServer/0`, { near: c, miles: 30 })).map((f) => {
    const a = attrs(f);
    const lines = [`${text(a, "ADDRESS")}, ${text(a, "CITY")}`, text(a, "HOURS_OF_OPERATION")];
    if (text(a, "ID_REQUIRED").toLowerCase().startsWith("y")) lines.push("ID required");
    return {
      id: `${kind}-${text(a, "OBJECTID")}`, title: text(a, "FACILITY"), lines: lines.filter(Boolean),
      phone: text(a, "PHONE"), lat: dbl(text(a, "LATITUDE")), lng: dbl(text(a, "LONGITUDE")),
    };
  });
}

export async function snap(c) {
  return (await query(SNAP, { near: c, miles: 3, limit: 200 })).map((f) => {
    const a = attrs(f);
    const lines = [text(a, "Store_Type"), `${text(a, "Store_Street_Address")}, ${text(a, "City")}`];
    if (text(a, "Incentive_Program")) lines.push(`Incentive: ${text(a, "Incentive_Program")}`);
    return {
      id: `snap-${text(a, "Record_ID")}`, title: capitalized(text(a, "Store_Name")), lines: lines.filter(Boolean),
      lat: dbl(text(a, "Latitude")), lng: dbl(text(a, "Longitude")),
    };
  });
}

export async function healthCenters() {
  const rows = await (await get("/data/health-centers.json")).json();
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const web = text(r, "web");
    const hours = text(r, "hours");
    return {
      id: `hc-${text(r, "name")}-${text(r, "address")}`, title: text(r, "name"),
      lines: [text(r, "org"), text(r, "address"), hours ? `${hours} hours a week` : ""].filter(Boolean),
      phone: text(r, "phone"), web: web ? (web.startsWith("http") ? web : `https://${web}`) : null,
      lat: typeof r.lat === "number" ? r.lat : null, lng: typeof r.lon === "number" ? r.lon : null,
    };
  });
}

export async function benefitsOffices() {
  const rows = await (await get(FSD)).json();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const loc = r?.location_1;
    if (!loc || typeof loc !== "object") continue;
    let addr = "";
    try {
      const a = typeof loc.human_address === "string" ? JSON.parse(loc.human_address) : null;
      if (a && typeof a === "object") addr = `${text(a, "address")}, ${text(a, "city")}`;
    } catch { /* no address */ }
    out.push({
      id: `fsd-${text(r, "resource_center")}`, title: text(r, "resource_center"),
      lines: [addr, text(r, "hours_of_operation"), capitalized(text(r, "drop_box_information"))].filter(Boolean),
      phone: text(r, "phone_number"), lat: dbl(text(loc, "latitude")), lng: dbl(text(loc, "longitude")),
    });
  }
  return out;
}

/** HUD-approved housing counselors within 15 miles. The server rounds the point to about 100 m; so does this call. */
export async function housingCounselors(c) {
  const r = await get(`/api/open/hud?lat=${c.lat.toFixed(3)}&lng=${c.lng.toFixed(3)}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(await problem(r));
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).map((x) => {
    const web = text(x, "weburl");
    return {
      id: `hud-${text(x, "agcid")}`, title: capitalized(text(x, "nme")),
      lines: [`${text(x, "adr1")}, ${text(x, "city")}`, `Languages: ${text(x, "languages")}`],
      // HUD writes "N/A" where an agency has no site; only a real web address gets the Website chip.
      phone: text(x, "phone1"), web: /^https?:\/\//i.test(web) ? web : null,
      lat: dbl(text(x, "agc_ADDR_LATITUDE")), lng: dbl(text(x, "agc_ADDR_LONGITUDE")),
    };
  });
}

// ---------- the screens ----------

const SCREENS = {
  stay: {
    title: "Somewhere to stay",
    intro: "Shelters and housing programs from the city's bed inventory. Bed counts are capacity, not tonight's openings: call 211 to find a bed today.",
    links: [{ title: "211: find a bed tonight", url: "https://www.unitedwaygkc.org/211" }],
    sections: [
      { name: "Shelters and housing", load: shelters },
      { name: "Cooling centers", load: (c) => centers("Cooling", c) },
      { name: "Warming centers", load: (c) => centers("Warming", c) },
    ],
  },
  food: {
    title: "Food",
    intro: "Food pantries and free meals are listed by Harvesters, the region's food bank. Stores that take SNAP (EBT) are below.",
    links: [
      { title: "Harvesters: find food near you", url: "https://www.harvesters.org/get-food-assistance/food-locator" },
      { title: "211: food help", url: "https://www.unitedwaygkc.org/211" },
    ],
    sections: [{ name: "Stores that take SNAP", load: snap }],
  },
  clinics: {
    title: "Low-cost clinics",
    intro: "Federally funded health centers. They see patients whether or not they have insurance, with fees based on income.",
    links: [],
    sections: [{ name: "Health centers", load: healthCenters }],
  },
  benefits: {
    title: "SNAP, Medicaid, and housing help",
    intro: "Missouri Family Support Division offices handle SNAP and Medicaid. HUD-approved counselors help with rent, eviction, and foreclosure.",
    links: [
      { title: "Missouri DSS: apply online", url: "https://dss.mo.gov" },
      { title: "Legal Aid of Western Missouri", url: "https://www.lawmo.org" },
    ],
    sections: [
      { name: "Family Support offices", load: benefitsOffices },
      { name: "Housing counselors", load: housingCounselors },
    ],
  },
};

function placeRow(p, m) {
  const tel = p.phone ? telHref(p.phone) : "";
  const chips = [
    tel ? chip(tel, icon("call"), p.phone === "211" ? "Call 211" : "Call", { about: p.title }) : "",
    !p.hidden && p.lat != null && p.lng != null ? chip(directions(p.lat, p.lng), icon("directions"), "Directions", { external: true, about: p.title }) : "",
    p.web ? chip(p.web, icon("open_in_new"), "Website", { external: true, about: p.title }) : "",
  ].filter(Boolean);
  return html`<li class="place stack s4">
    <div class="row base">
      <h3 class="headline grow">${p.title}${p.badge ? html` <span class="badge-help">${p.badge}</span>` : ""}</h3>
      ${m == null ? "" : html`<span class="caption muted mono">${distance(m)}</span>`}
    </div>
    ${p.lines.filter(Boolean).map((l) => html`<p class="caption muted">${l}</p>`)}
    ${chips.length ? html`<div class="chips">${chips}</div>` : ""}
  </li>`;
}

export default function placesView(main, { kind }, ctx) {
  const screen = Object.hasOwn(SCREENS, kind) ? SCREENS[kind] : null;
  if (!screen) {
    render(main, html`<div class="screen city-ui">${empty({ icon: "search_off", title: "This page does not exist." })}</div>`);
    return null;
  }
  ctx.title(screen.title);
  let here = null;
  let dead = false;
  let busy = false;
  const results = {};
  const errors = {};

  render(main, html`<div class="screen city-ui stack s20">
    <div class="rows">
      <p class="cell sub muted">${screen.intro}</p>
      ${screen.links.map((l) => html`<a class="item" href="${safeUrl(l.url)}" target="_blank" rel="noopener">
        <span class="grow primary-text">${l.title}</span>${icon("open_in_new", "trail")}
      </a>`)}
    </div>
    ${screen.sections.map((s, i) => html`<section class="stack s8">${label(s.name)}<div data-sec="${i}"></div></section>`)}
    ${refreshButton()}
  </div>`);

  /** Nearest first; a place without a position goes last. */
  const sorted = (list) => {
    const c = here || DOWNTOWN;
    return list
      .map((p) => [p, p.lat != null && p.lng != null ? meters(c, p) : null])
      .sort((a, b) => (a[1] ?? Infinity) - (b[1] ?? Infinity));
  };

  const paint = (s, i) => {
    const el = main.querySelector(`[data-sec="${i}"]`);
    if (dead || !el) return;
    const e = errors[s.name];
    const list = results[s.name];
    render(el, e ? html`<div class="rows"><p class="cell caption error-text">Could not load: ${e}</p></div>`
      : !list ? html`<div class="rows">${loadingRow(`Loading ${s.name}`)}</div>`
      : !list.length ? html`<div class="rows"><p class="cell caption muted">None nearby.</p></div>`
      : html`<ul class="rows">${sorted(list).slice(0, 30).map(([p, m]) => placeRow(p, m))}</ul>`);
  };

  const load = async () => {
    if (busy) return;
    busy = true;
    try {
      here = (await currentIfAllowed()) || DOWNTOWN;
      await Promise.all(screen.sections.map(async (s, i) => {
        try {
          results[s.name] = await s.load(here);
          errors[s.name] = null;
        } catch (e) {
          // A failed refresh keeps the list it already shows.
          if (!results[s.name]) errors[s.name] = reason(e);
        }
        paint(s, i);
      }));
    } finally {
      busy = false;
    }
  };

  screen.sections.forEach(paint);
  load();
  const add = bag();
  add(acts(main, { refresh: () => load() }));
  return () => { dead = true; add.run(); };
}
