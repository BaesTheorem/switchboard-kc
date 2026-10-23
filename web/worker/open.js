// Relays for the open-data sources the browser cannot read directly (they
// send no CORS headers). Each relay calls one fixed host, so it is not an
// open proxy. Every other source the app uses answers browsers itself.

import { HttpError } from "./util.js";

const cached = (r, seconds, type) =>
  new Response(r.body, { status: r.status, headers: { "content-type": type, "cache-control": `public, max-age=${seconds}` } });

/** HUD-approved housing counselors near a point. */
export async function hud(url) {
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!(lat > 38 && lat < 40.5 && lng > -96 && lng < -93)) throw new HttpError(400, "bad_point", "That point is not near Kansas City.");
  const r = await fetch(`https://data.hud.gov/Housing_Counselor/searchByLocation?Lat=${lat.toFixed(3)}&Long=${lng.toFixed(3)}&Distance=15`, {
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!r.ok) throw new HttpError(502, "hud", "HUD's counselor list did not answer.");
  return cached(r, 86400, "application/json");
}

/** RideKC's static GTFS feed (about 1.9 MB), cached a day at the edge. */
export async function gtfs() {
  const r = await fetch("https://ridekc.org/static-gtfs", { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) throw new HttpError(502, "gtfs", "RideKC's schedule did not answer.");
  return cached(r, 86400, "application/zip");
}

// City meetings come from Common Lot (github.com/BaesTheorem/common-lot): its
// Worker keeps a copy of the city's Legistar calendar and the EDC boards.
const COMMON_LOT = "https://common-lot.alex-hedtke.workers.dev";
const commonLot = (env) => (env.COMMON_LOT_URL || COMMON_LOT).replace(/\/$/, "");
// A Worker cannot fetch another Worker's workers.dev address on the same
// account (Cloudflare error 1042), so the owner's server calls Common Lot
// through a Service Binding. A self-hosted server has no binding and uses
// the public address.
// A failure there (a Service Binding throws when Common Lot's Worker fails) is a 502 here, not a crash.
const fromCommonLot = (env, path, ttl) => (env.COMMON_LOT
  ? env.COMMON_LOT.fetch(new Request(`${commonLot(env)}${path}`))
  : fetch(`${commonLot(env)}${path}`, { cf: { cacheTtl: ttl, cacheEverything: true } }))
  .catch(() => { throw new HttpError(502, "common_lot", "The meeting list did not answer. Try again in a minute."); });

/** Every city meeting, or the board descriptions (`what` = "meetings" | "bodies"). */
export async function meetings(env, what) {
  const ttl = what === "bodies" ? 86400 : 300;
  const r = await fromCommonLot(env, `/api/${what}`, ttl);
  if (!r.ok) throw new HttpError(502, "meetings", "The meeting list did not answer.");
  return cached(r, ttl, "application/json");
}

/**
 * A calendar feed: /cal/all.ics, /cal/body/<id>.ics or /cal/meeting/<id>.ics.
 * Subscriptions use this server's address, so they keep working if Common
 * Lot moves to a new address.
 */
export async function calendarFeed(env, path) {
  if (!/^\/cal\/(all|body\/\d{1,6}|meeting\/[\w-]{1,40})\.ics$/.test(path)) throw new HttpError(404, "not_found", "No such calendar.");
  const r = await fromCommonLot(env, path, 900);
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, "calendar", "That calendar is not available.");
  const res = cached(r, 900, "text/calendar; charset=utf-8");
  const cd = r.headers.get("content-disposition");
  if (cd) res.headers.set("content-disposition", cd);
  return res;
}
