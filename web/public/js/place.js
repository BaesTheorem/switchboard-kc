// Where a report comes from, in words a crew can use: the GPS point, the
// nearest address, and the nearest intersection. Ported from Place.swift.
//
// Addresses come from the city's own locators first (the MyKCMO and
// AddressPoints geocoders on mapd.kcmo.org), so the street text matches the
// city's records and its duplicate check. OpenStreetMap's Nominatim covers
// points the city's locators do not know. Intersections come from US Census
// TIGER roads.

import { meters } from "./lib/geo.js";

const LOC = "https://mapd.kcmo.org/kcgis/rest/services";
const ABBR = { North: "N", South: "S", East: "E", West: "W", Street: "St", Road: "Rd", Avenue: "Ave", Boulevard: "Blvd",
  Drive: "Dr", Parkway: "Pkwy", Terrace: "Ter", Place: "Pl", Lane: "Ln", Court: "Ct", Trafficway: "Trfy", Highway: "Hwy" };

/** The city matches duplicate reports on USPS-style addresses ("E Truman Rd"). Empty words drop out, as in Swift's split. */
export const uspsAbbreviated = (s) => String(s || "").split(" ").filter(Boolean).map((w) => ABBR[w] || w).join(" ");

/** "12 St" → "12th St", as TIGER names come without ordinals. */
export function ordinal(name) {
  return String(name || "").replace(/\b(\d+) (St|Ter|Pl|Ave|Rd|Ct|Dr|Ln|Cir)\b/g, (_, n, t) => {
    const k = Number(n);
    const suf = k % 100 >= 10 && k % 100 <= 20 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[k % 10] || "th";
    return `${k}${suf} ${t}`;
  });
}

async function getJSON(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const reverseURL = (locator, pt, dist) =>
  `${LOC}/${locator}/GeocodeServer/reverseGeocode?location=${pt.lng},${pt.lat}&distance=${dist}&outSR=4326&f=json`;

/** The nearest street address: { lat, lng, street, city, state, zip }. Never throws. */
export async function address(pt) {
  const base = { lat: pt.lat, lng: pt.lng, city: "Kansas City", state: "MO", zip: "" };
  const ap = await getJSON(reverseURL("locators2/AddressPoints", pt, 100));
  if (ap?.address?.Address) {
    return { ...base, street: ap.address.Address, city: ap.address.City || base.city, state: ap.address.RegionAbbr || "MO", zip: ap.address.Postal || "" };
  }
  const my = await getJSON(reverseURL("locators/MyKCMO", pt, 150));
  const m = /^(.+?),\s*(.+?),\s*([A-Z]{2}),\s*(\d{5})/.exec(my?.address?.Match_addr || "");
  if (m) return { ...base, street: m[1], city: m[2], state: m[3], zip: m[4] };
  const osm = await getJSON(`https://nominatim.openstreetmap.org/reverse?lat=${pt.lat}&lon=${pt.lng}&format=jsonv2&zoom=18&addressdetails=1`);
  const a = osm?.address;
  if (a?.road) {
    const street = uspsAbbreviated([a.house_number?.split(/[-–;,]/)[0], a.road].filter(Boolean).join(" "));
    return { ...base, street, city: a.city || a.town || a.village || base.city, state: "MO", zip: a.postcode || "" };
  }
  return { ...base, street: `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}` };
}

/** Address suggestions as the user types, from the city's locator. */
export async function suggest(text) {
  if (String(text).trim().length < 3) return [];
  const o = await getJSON(`${LOC}/locators/MyKCMO/GeocodeServer/suggest?text=${encodeURIComponent(text)}&maxSuggestions=6&f=json`, 6000);
  return (o?.suggestions || []).map((s) => ({ text: s.text, magicKey: s.magicKey }));
}

/** The point for a suggestion (or typed text). */
export async function locate(text, magicKey = "") {
  const o = await getJSON(`${LOC}/locators/MyKCMO/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(text)}&magicKey=${encodeURIComponent(magicKey)}&outSR=4326&maxLocations=1&f=json`, 8000);
  const c = o?.candidates?.[0];
  return c ? { lat: c.location.y, lng: c.location.x, text: c.address } : null;
}

const core = (s) => s.replace(/^[NSEW] /, "");

/** Nearest vertex shared by two different roads, from US Census TIGER: [[name, name], meters] or null. */
export async function intersection(pt, radius = 150) {
  const q = new URLSearchParams({
    geometry: `${pt.lng},${pt.lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    distance: String(radius), units: "esriSRUnit_Meter", outFields: "NAME", returnGeometry: "true", outSR: "4326", f: "json",
  });
  const o = await getJSON(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8/query?${q}`);
  if (!o?.features) return null;
  const at = new Map();
  for (const f of o.features) {
    const name = f.attributes?.NAME;
    if (!name) continue;
    const clean = uspsAbbreviated(ordinal(name));
    for (const path of f.geometry?.paths || []) {
      for (const p of path) {
        const key = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
        if (!at.has(key)) at.set(key, { lat: p[1], lng: p[0], names: new Set() });
        at.get(key).names.add(clean);
      }
    }
  }
  let best = null;
  for (const v of at.values()) {
    const byCore = new Map();
    for (const n of [...v.names].sort()) byCore.set(core(n), n);
    if (byCore.size < 2) continue;
    const d = meters(pt, v);
    if (!best || d < best[1]) best = [[...byCore.values()].sort().slice(0, 2), d];
  }
  return best;
}

/** The facts for a point: address, street, cross street, intersection, and a summary line. */
export async function facts(pt, source) {
  const f = { lat: pt.lat, lng: pt.lng, source, address: "", street: "", crossStreet: "", intersection: "" };
  const [a, x] = await Promise.all([address(pt), intersection(pt)]);
  if (!a.street.includes(",")) {
    f.address = `${a.street}, ${a.city}, ${a.state} ${a.zip}`.trim();
    f.street = a.street.replace(/^\d+[A-Z]?\s+/, "");
  }
  if (x) {
    f.intersection = `${x[0].join(" & ")} (about ${Math.round(x[1])} m away)`;
    f.crossStreet = x[0].find((n) => core(n) !== core(f.street)) || "";
  }
  return f;
}

export function summary(f) {
  const parts = [`GPS ${f.lat.toFixed(6)}, ${f.lng.toFixed(6)} (${f.source})`];
  if (f.address) parts.push(`nearest address ${f.address}`);
  if (f.intersection) parts.push(`nearest intersection ${f.intersection}`);
  return parts.join("; ");
}

export const factsLine = (f) => `Location: ${summary(f)}.`;

const WHERE = /locat|intersection|where is|street ?\/ ?location|address or intersection|specific address|area of (traffic )?concern|where .*needed/i;
const NOT = /e-?mail|employer|current address|your name|rental|business|company|manager|how many|property issues|when|visit|assisted|county|verify/i;

/** The answer for a free-text question that asks where, or null. */
export function answerFor(f, caption) {
  const c = caption.trim().toLowerCase();
  if (c === "street") return f.street || null;
  if (c === "intersecting street" || c === "cross street") return f.crossStreet || null;
  if (!WHERE.test(caption) || NOT.test(caption)) return null;
  return summary(f);
}
