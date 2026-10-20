// MapLibre GL JS with OpenFreeMap's vector tiles (free, no key). Loaded on
// first use, so screens without a map stay light.

import { isDark } from "./theme.js";

let mod = null;
function css() {
  if (document.querySelector("link[data-maplibre]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "/vendor/maplibre/maplibre-gl.css";
  l.dataset.maplibre = "";
  document.head.append(l);
}

export async function maplibre() {
  css();
  mod ||= import("/vendor/maplibre/maplibre-gl.mjs");
  return mod;
}

export const styleUrl = (dark = isDark()) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;

/** Meters across the view → a zoom level at Kansas City's latitude. */
export function zoomFor(metersAcross, pixels = Math.min(innerWidth, 700)) {
  const mPerPx = metersAcross / pixels;
  return Math.max(3, Math.min(19, Math.log2((156543.03 * Math.cos((39.1 * Math.PI) / 180)) / mPerPx)));
}

/**
 * A map in `container`. Returns { map, ml, ready } where `ready` resolves when
 * the style has loaded. `onStyle(map)` runs after every style load (the
 * theme switch swaps the style, which drops custom layers).
 */
export async function makeMap(container, { center, metersAcross = 2500, interactive = true, onStyle } = {}) {
  const ml = await maplibre();
  const map = new ml.Map({
    container,
    style: styleUrl(),
    center: [center.lng, center.lat],
    zoom: zoomFor(metersAcross, container.clientWidth || 360),
    interactive,
    attributionControl: { compact: true },
    pitchWithRotate: false,
    dragRotate: false,
    fadeDuration: 0,
  });
  map.touchZoomRotate?.disableRotation?.();
  const ready = new Promise((resolve) => map.once("load", resolve));
  if (onStyle) map.on("style.load", () => onStyle(map));
  const theme = () => map.setStyle(styleUrl());
  document.addEventListener("themechange", theme);
  map.once("remove", () => document.removeEventListener("themechange", theme));
  return { map, ml, ready };
}

/** Removes a map and its listeners. */
export const dispose = (m) => { try { m?.map?.remove(); } catch { /* already gone */ } };
