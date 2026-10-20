// The device position and distances.

export const DOWNTOWN = { lat: 39.0997, lng: -94.5786 };

export function meters(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

let last = null;
export const lastKnown = () => last;

/** The current position, asking for permission if needed. Null when denied or unavailable. */
export function current({ timeout = 12000 } = {}) {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => { last = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(last); },
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

/** The current position only when permission was already given; never prompts. */
export async function currentIfAllowed() {
  try {
    const p = await navigator.permissions?.query({ name: "geolocation" });
    if (p?.state !== "granted") return last;
  } catch {
    return last;
  }
  return current({ timeout: 8000 });
}
