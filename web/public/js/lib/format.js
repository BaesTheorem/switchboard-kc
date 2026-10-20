// Dates, times, and distances in the words the iPhone app uses.

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS = [["year", 31536e6], ["month", 2592e6], ["week", 6048e5], ["day", 864e5], ["hour", 36e5], ["minute", 6e4]];

/** "2 days ago", "in 3 hours", "now". */
export function relative(d, now = Date.now()) {
  if (!d) return "";
  const ms = (d instanceof Date ? d.getTime() : d) - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(ms) >= size) return rtf.format(Math.round(ms / size), unit);
  }
  return "now";
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export const shortDate = (d) => (d ? dateFmt.format(d) : "");
export const dateTime = (d) => (d ? dateTimeFmt.format(d) : "");
export const clockTime = (d) => (d ? timeFmt.format(d) : "");

/** Feet under a tenth of a mile, else miles with one decimal. */
export function distance(m) {
  const mi = m / 1609.34;
  return mi < 0.1 ? `${Math.floor((m * 3.281) / 10) * 10} ft` : `${mi.toFixed(1)} mi`;
}

/** Seconds after midnight as "7:05 PM" (GTFS times can pass 24:00). */
export function clockFromSeconds(s) {
  const h = Math.floor(s / 3600) % 24, m = Math.floor((s % 3600) / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const capitalize = (s) => String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
