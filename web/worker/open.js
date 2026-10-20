// Relays for the two open-data sources the browser cannot read directly
// (they send no CORS headers). Each relay calls one fixed host, so it is
// not an open proxy. Every other source the app uses answers browsers itself.

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
