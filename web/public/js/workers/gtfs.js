// Reads RideKC's GTFS feed off the main thread: the stops nearest a point (up
// to 6 within 800 m) and their departures in the next two hours, for the
// services running today (calendar.txt and calendar_dates.txt), 5 per stop.
// The page posts { zip, here: { lat, lng }, now } (now in epoch ms) and gets
// back { stops } or { error }. Ported from GTFS in Transit.swift.

import { meters } from "../lib/geo.js";
import { readZip } from "../lib/zip.js";

const FILES = ["stops.txt", "calendar.txt", "calendar_dates.txt", "routes.txt", "trips.txt", "stop_times.txt"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Swift's newline characters: LF, VT, FF, CR, NEL (0x85), and the Unicode line and
// paragraph separators. CR LF counts as one.
const NEWLINE = `\\r\\n|[\\n\\v\\f\\r\\x85${String.fromCharCode(0x2028, 0x2029)}]`;
const BOM = String.fromCharCode(0xfeff);

/** Swift's Double(String): null for empty or malformed text. */
function dbl(s) {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Swift's Int(String): optional sign and ASCII digits only. */
const int = (s) => (/^[+-]?\d+$/.test(s) ? Number(s) : null);

/** Each non-empty line of a text. Any newline character ends a line, and "\r\n" counts as one. */
function* lines(text) {
  const re = new RegExp(NEWLINE, "g");
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) yield text.slice(at, m.index);
    at = re.lastIndex;
  }
  if (at < text.length) yield text.slice(at);
}

/** A CSV line's fields. Handles quoted fields with commas. */
export function fields(line) {
  if (!line.includes('"')) return line.split(",");
  const out = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A header name without spaces or a byte order mark at its ends. */
function headerName(k) {
  let a = 0;
  let b = k.length;
  while (a < b && (k[a] === " " || k[a] === BOM)) a++;
  while (b > a && (k[b - 1] === " " || k[b - 1] === BOM)) b--;
  return k.slice(a, b);
}

/**
 * CSV rows as objects keyed by the header, values trimmed. `keep(row)`
 * filters the rows. `maybe(line)` can skip a line before it is parsed; it
 * must pass every line that `keep` could keep.
 */
export function rows(text, keep, maybe) {
  const it = lines(text);
  const head = it.next();
  if (head.done) return [];
  const keys = fields(head.value).map(headerName);
  const out = [];
  for (const line of it) {
    if (maybe && !maybe(line)) continue;
    const v = fields(line);
    const r = Object.create(null);
    for (let i = 0; i < keys.length && i < v.length; i++) r[keys[i]] = v[i].trim();
    if (!keep || keep(r)) out.push(r);
  }
  return out;
}

/**
 * The nearest stops and their departures. `files` maps a file name to its
 * text; `here` is { lat, lng }; `now` is a time in epoch ms (the device's time zone).
 */
export function nearby(files, here, now) {
  const file = (n) => files.get(n) || "";
  const stops = [];
  for (const r of rows(file("stops.txt"))) {
    const lat = dbl(r.stop_lat);
    const lng = dbl(r.stop_lon);
    const id = r.stop_id;
    if (lat == null || lng == null || id == null) continue;
    stops.push({ id, name: r.stop_name ?? id, lat, lng, meters: meters(here, { lat, lng }), departures: [] });
  }
  const near = stops.filter((s) => s.meters < 800).sort((a, b) => a.meters - b.meters).slice(0, 6);
  if (!near.length) return [];
  const want = new Set(near.map((s) => s.id));

  // Services running today.
  const d = new Date(now);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const ymd = `${pad(d.getFullYear(), 4)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const weekday = DAYS[d.getDay()];
  const services = new Set();
  for (const r of rows(file("calendar.txt"))) {
    if (r[weekday] === "1" && (r.start_date ?? "") <= ymd && ymd <= (r.end_date ?? "") && r.service_id != null) services.add(r.service_id);
  }
  for (const r of rows(file("calendar_dates.txt"))) {
    if (r.date !== ymd || r.service_id == null) continue;
    if (r.exception_type === "1") services.add(r.service_id);
    else if (r.exception_type === "2") services.delete(r.service_id);
  }

  // A route's short name, else its long name, else its id. The first row for an id wins.
  const routes = new Map();
  for (const r of rows(file("routes.txt"))) {
    if (r.route_id == null || routes.has(r.route_id)) continue;
    routes.set(r.route_id, r.route_short_name ? r.route_short_name : r.route_long_name ?? r.route_id);
  }
  const trips = new Map();
  for (const r of rows(file("trips.txt"))) {
    if (!services.has(r.service_id ?? "") || r.trip_id == null) continue;
    trips.set(r.trip_id, { route: routes.get(r.route_id ?? "") ?? "", headsign: r.trip_headsign ?? "" });
  }

  const nowSec = d.getHours() * 3600 + d.getMinutes() * 60;
  const ids = [...want];
  const byStop = new Map();
  // stop_times.txt is the large file (about 10 MB). A line that names none of
  // the wanted stops cannot match, so it is skipped before it is parsed.
  const times = rows(file("stop_times.txt"), (r) => want.has(r.stop_id ?? ""),
    (line) => line.includes('"') || ids.some((id) => line.includes(id)));
  for (const r of times) {
    const stop = r.stop_id;
    const t = trips.get(r.trip_id ?? "");
    if (stop == null || !t) continue;
    const parts = (r.departure_time ?? "").split(":").filter((p) => p !== "").map(int).filter((n) => n != null);
    if (parts.length !== 3) continue;
    const sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (sec < nowSec || sec > nowSec + 7200) continue;
    if (!byStop.has(stop)) byStop.set(stop, []);
    byStop.get(stop).push({ route: t.route, headsign: t.headsign, seconds: sec });
  }
  return near.map((s) => ({ ...s, departures: (byStop.get(s.id) || []).sort((a, b) => a.seconds - b.seconds).slice(0, 5) }));
}

/** The feed's text files, from the zip bytes. */
export async function unzip(zip) {
  const entries = await readZip(zip, (n) => FILES.includes(n));
  const dec = new TextDecoder();
  return new Map([...entries].map(([n, b]) => [n, dec.decode(b)]));
}

if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = async (e) => {
    try {
      const { zip, here, now } = e.data;
      self.postMessage({ stops: nearby(await unzip(zip), here, now) });
    } catch (err) {
      self.postMessage({ error: err?.message || String(err) });
    }
  };
}
