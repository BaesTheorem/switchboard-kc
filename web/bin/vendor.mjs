#!/usr/bin/env node
// Copies the third-party files the app serves into public/vendor/, and builds
// a Material Symbols font with only the icons the app uses (about 1/20 the
// size of the full font). Run after `npm install` and after adding an icon:
//   node bin/vendor.mjs
// The icon list it used is written to public/vendor/icons.json; the e2e tests
// check every icon the app draws against it.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(web, "public");
const nm = join(web, "node_modules");

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

// Beer CSS: keep only the Outlined icon font, served from here. Its other
// @font-face rules and CDN fallbacks would load fonts from jsDelivr, which the
// app's Content-Security-Policy refuses anyway.
mkdirSync(join(pub, "vendor/beercss"), { recursive: true });
writeFileSync(join(pub, "vendor/beercss/beer.min.css"), readFileSync(join(nm, "beercss/dist/cdn/beer.min.css"), "utf8")
  .replace(/@font-face\{font-family:Material Symbols (Rounded|Sharp|Subset);[^}]*\}/g, "")
  .replace(/,url\(https:\/\/cdn\.jsdelivr\.net[^)]*\) format\("woff2"\)/g, ""));
copy(join(nm, "beercss/LICENSE"), join(pub, "vendor/beercss/LICENSE"));
for (const f of ["maplibre-gl.mjs", "maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs", "maplibre-gl.css"]) {
  copy(join(nm, "maplibre-gl/dist", f), join(pub, "vendor/maplibre", f));
}
copy(join(nm, "maplibre-gl/LICENSE.txt"), join(pub, "vendor/maplibre/LICENSE.txt"));

// ---------- icons ----------

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "vendor" ? [] : files(p)) : /\.(js|html)$/.test(n) ? [p] : [];
  });
}

const names = new Set(["arrow_back", "settings", "check", "close", "search", "refresh", "chevron_right", "open_in_new", "report"]);
const patterns = [
  /\bicon\(\s*["']([a-z0-9_]+)["']/g,
  /<i\b[^>]*>([a-z0-9_]+)<\/i>/g,
  /\bicon:\s*["']([a-z0-9_]+)["']/g,
  /\[\s*"[^"]+",\s*"([a-z0-9_]+)"\s*\]/g,                // [match, icon] tables
  /\?\s*"([a-z0-9_]+)"\s*:\s*"([a-z0-9_]+)"/g,           // cond ? "a" : "b"
];
for (const f of files(pub)) {
  const src = readFileSync(f, "utf8");
  for (const re of patterns) for (const m of src.matchAll(re)) for (const g of m.slice(1)) if (g && /_|^[a-z]{3,}$/.test(g)) names.add(g);
}
// Words the patterns catch that are not icons.
for (const w of ["open", "closed", "all", "auto", "light", "dark", "email", "invite", "off", "mine", "public", "yes", "no", "sms", "tel"]) {
  if (!["sms"].includes(w)) names.delete(w);
}
const sorted = [...names].sort();
const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const cssURL = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0&icon_names=${sorted.join(",")}&display=block`;
const css = await (await fetch(cssURL, { headers: { "user-agent": ua } })).text();
const woff = /url\((https:[^)]+)\)\s*format\(['"]woff2['"]\)/.exec(css)?.[1];
if (!woff) {
  console.error("Google Fonts did not return a font. Response:\n", css.slice(0, 500));
  process.exit(1);
}
const font = new Uint8Array(await (await fetch(woff, { headers: { "user-agent": ua } })).arrayBuffer());
writeFileSync(join(pub, "vendor/beercss/material-symbols-outlined.woff2"), font);
writeFileSync(join(pub, "vendor/icons.json"), JSON.stringify(sorted, null, 1));
console.log(`vendor: beer.css, maplibre, ${sorted.length} icons (${(font.length / 1024).toFixed(1)} KB font)`);
