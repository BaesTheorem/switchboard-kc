// My reports and everyone else's on one map, or in a list. Mine are dark
// person pins drawn on top; in the list they sit in a "Yours" section above
// "Nearby". Open / Closed / All and a time scope apply to both; "Only mine"
// hides everyone else. Ported from ReportsTab in OtherTabs.swift.
//
// The web map draws every public pin as one WebGL circle layer, so it needs
// no 250-pin cap. The list is the screen-reader view of the same reports.

import { distance, relative, shortDate } from "../lib/format.js";
import { DOWNTOWN, current, currentIfAllowed, meters } from "../lib/geo.js";
import { bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { local } from "../lib/store.js";
import { dispose, makeMap } from "../map.js";
import { stage } from "../models.js";
import {
  asTarget, cachedFullDetail, fullDetail, listen, loadMap, loadMyReports, S, visibleReports,
} from "../state.js";
import { empty, sheet, spinner, statusChip, stageVar, track } from "../ui.js";
import { reportCard, requestUpdateButton, wireRequestUpdates } from "./parts.js";

const SCOPES = [[365, "1 year"], [182, "6 months"], [90, "90 days"], [30, "30 days"]];

export default function view(main, _params, ctx) {
  const off = bag();
  let status = sessionStorage.getItem("mapStatus") || "open";
  let scopeDays = local.get("mapScopeDays", 365);
  let onlyMine = local.get("onlyMine", false);
  let listMode = local.get("nearbyList", false);
  let center = S.mapCenter || DOWNTOWN;
  let selected = null;
  let m = null, mineMarkers = [], meMarker = null;

  const scopeLabel = () => (SCOPES.find(([d]) => d === scopeDays) || SCOPES[0])[1];
  const cutoff = () => Date.now() - scopeDays * 86400e3;
  const issues = () => (S.map[status] || []).filter((i) => (i.submitted ?? Infinity) >= cutoff());
  const mineIds = () => new Set(visibleReports().map((r) => r.id));
  const mine = () => visibleReports().filter((r) => (status === "all" || (status === "open") === r.isOpen) && (r.added?.getTime() ?? Infinity) >= cutoff());
  const others = () => { if (onlyMine) return []; const ids = mineIds(); return issues().filter((i) => !ids.has(i.id)); };
  const loading = () => S.mapLoading.has(status);

  render(main, html`<div class="mapwrap">
    <div class="map" id="map" ${listMode ? "hidden" : ""}></div>
    <div id="list" class="screen" ${listMode ? "" : "hidden"} style="position:absolute;inset:0;overflow:auto;padding-top:132px;max-width:none"></div>
    <div class="map-controls" role="toolbar" aria-label="Report filters">
      <div class="seg grow" role="group" aria-label="Status">
        ${["open", "closed", "all"].map((s) => html`<button type="button" data-status="${s}" aria-pressed="${String(s === status)}">${s[0].toUpperCase() + s.slice(1)}</button>`)}
      </div>
      <span class="icon-btn scope" title="Reported in the past">${icon("date_range")}
        <select id="scope" aria-label="Reported in the past">
          ${SCOPES.map(([d, l]) => html`<option value="${d}" ${d === scopeDays ? "selected" : ""}>${l}</option>`)}
        </select></span>
      <button class="icon-btn" type="button" id="refresh" aria-label="Search this area"></button>
      <button class="icon-btn" type="button" id="mode" aria-label="${listMode ? "Show map" : "Show list"}">${icon(listMode ? "map" : "list")}</button>
    </div>
    <div class="map-caption"><span class="pill" id="caption"></span><span id="who"></span>
      <span class="grow"></span><button class="pill" type="button" id="me" aria-label="Go to my location" ${listMode ? "hidden" : ""}>${icon("my_location")}</button></div>
    <div class="map-bottom" id="bottom" aria-live="polite"></div>
  </div>`);
  const $ = (s) => main.querySelector(s);

  // ---------- chrome ----------
  const paintChrome = () => {
    for (const b of main.querySelectorAll("[data-status]")) b.setAttribute("aria-pressed", String(b.dataset.status === status));
    render($("#refresh"), loading() ? html`<progress class="circle small" aria-label="Loading"></progress>` : icon("refresh"));
    $("#refresh").setAttribute("aria-label", loading() ? "Loading" : "Search this area");
    const n = others().length, k = mine().length;
    $("#caption").textContent = `Past ${scopeLabel()} · ${[k ? `${k} yours` : null, onlyMine ? null : `${n} nearby`].filter(Boolean).join(" · ")}`;
    render($("#who"), visibleReports().length ? html`<button class="pill ${onlyMine ? "on" : ""}" type="button" id="only"
      aria-label="${onlyMine ? "Showing only your reports. Show everyone's" : "Showing everyone's reports. Show only yours"}">
      ${icon(onlyMine ? "person" : "groups")}<span>${onlyMine ? "Only mine" : "Everyone"}</span></button>` : "");
    const bottom = $("#bottom");
    if (selected && !listMode) render(bottom, pinCard(selected));
    else if (S.mapError) render(bottom, html`<div class="error-box foot">${S.mapError}</div>`);
    else if (!loading() && !others().length && !mine().length && !listMode) {
      render(bottom, html`<div class="pill" style="padding:8px 14px;font-size:13px">No ${status === "all" ? "" : `${status} `}reports here in the past ${scopeLabel()}.</div>`);
    } else bottom.replaceChildren();
  };

  // ---------- map ----------
  const colors = () => {
    const cs = getComputedStyle(document.body);
    return { open: cs.getPropertyValue("--open").trim(), working: cs.getPropertyValue("--primary").trim(), done: cs.getPropertyValue("--done").trim(), surface: cs.getPropertyValue("--surface").trim() };
  };
  const geojson = () => ({
    type: "FeatureCollection",
    features: others().map((i) => ({ type: "Feature", properties: { id: i.id, st: stage(i.status) }, geometry: { type: "Point", coordinates: [i.lng, i.lat] } })),
  });
  const addLayers = (map) => {
    const c = colors();
    if (map.getSource("issues")) return;
    map.addSource("issues", { type: "geojson", data: geojson() });
    map.addLayer({ id: "issues", type: "circle", source: "issues", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 13, 6, 15, 9, 18, 12],
      "circle-color": ["match", ["get", "st"], 2, c.working, 3, c.done, c.open],
      "circle-stroke-width": 1.5, "circle-stroke-color": c.surface,
    } });
    map.addLayer({ id: "issues-sel", type: "circle", source: "issues", filter: ["==", ["get", "id"], selected?.id || ""], paint: {
      "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": c.working,
    } });
  };
  const paintMap = () => {
    if (!m?.map.getSource("issues")) return;
    m.map.getSource("issues").setData(geojson());
    m.map.setFilter("issues-sel", ["==", ["get", "id"], selected?.id || ""]);
    for (const mk of mineMarkers) mk.remove();
    mineMarkers = mine().filter((r) => r.lat != null && r.lng != null).map((r) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "mine-pin";
      el.setAttribute("aria-label", `Yours: ${r.label}`);
      el.innerHTML = '<i aria-hidden="true">person</i>';
      el.addEventListener("click", (e) => { e.stopPropagation(); ctx.go(`/reports/mine/${r.id}`); });
      return new m.ml.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(m.map);
    });
  };
  const showMe = (pt) => {
    if (!m || !pt) return;
    if (!meMarker) {
      const el = document.createElement("div");
      el.className = "me-dot";
      el.setAttribute("aria-hidden", "true");
      meMarker = new m.ml.Marker({ element: el });
    }
    meMarker.setLngLat([pt.lng, pt.lat]).addTo(m.map);
  };

  const startMap = async () => {
    if (m || listMode) return;
    m = await makeMap($("#map"), { center, metersAcross: 2500, onStyle: (map) => { addLayers(map); paintMap(); } });
    // A tap selects the nearest pin within 16 px, so small pins are easy to hit.
    m.map.on("click", (e) => {
      const { x, y } = e.point;
      const hits = m.map.queryRenderedFeatures([[x - 16, y - 16], [x + 16, y + 16]], { layers: ["issues"] });
      const near = hits.map((f) => [f, Math.hypot(...[0, 1].map((k) => m.map.project(f.geometry.coordinates)[k ? "y" : "x"] - (k ? y : x)))])
        .sort((a, b) => a[1] - b[1])[0]?.[0];
      selected = near ? issues().find((i) => i.id === near.properties.id) || null : null;
      paintMap();
      paintChrome();
    });
    m.map.on("mouseenter", "issues", () => { m.map.getCanvas().style.cursor = "pointer"; });
    m.map.on("mouseleave", "issues", () => { m.map.getCanvas().style.cursor = ""; });
    m.map.on("moveend", () => { const c = m.map.getCenter(); center = { lat: c.lat, lng: c.lng }; });
    const here = await currentIfAllowed();
    if (here && m) { showMe(here); if (!S.mapCenter || meters(here, center) > 1500) m.map.jumpTo({ center: [here.lng, here.lat] }); center = here; }
  };
  off(() => { for (const mk of mineMarkers) mk.remove(); dispose(m); m = null; });

  // ---------- list ----------
  const paintList = () => {
    if (!listMode) return;
    const rows = others().map((i) => [i, meters(center, i)]).sort((a, b) => a[1] - b[1]);
    const shown = rows.slice(0, 300);
    const openCount = visibleReports().filter((r) => r.isOpen).length;
    const ms = mine();
    render($("#list"), html`<div class="stack s20" style="max-width:720px;margin:0 auto">
      ${ms.length || S.queued.length ? html`<section class="stack s12" aria-labelledby="yours-h">
        <div class="row"><h2 class="label grow" id="yours-h">Yours</h2>
          ${openCount ? html`<a class="link" href="#/reports/updates">${icon("notifications_active")}<span>&nbsp;Request updates</span></a>` : ""}</div>
        ${S.queued.map((q) => html`<div class="card row">${icon("cloud_upload", "open-text")}<div class="stack s4"><p class="sub strong">${q.title}</p><p class="caption muted">Waiting to send</p></div></div>`)}
        ${ms.map((r) => reportCard(r, `#/reports/mine/${r.id}`))}
      </section>` : ""}
      ${onlyMine ? "" : html`<section class="stack s8" aria-labelledby="near-h">
        <h2 class="label" id="near-h">Nearby</h2>
        ${!rows.length ? (loading() ? spinner() : empty({ icon: "search_off", title: "No reports", message: "Try another status or a longer time." })) : html`
        <div class="rows">${shown.map(([i, d]) => html`<button class="item" type="button" data-pub="${i.id}" style="align-items:flex-start">
          <span class="dot st-${stage(i.status)}" aria-hidden="true"></span>
          <span class="grow stack s4" style="gap:3px"><span class="sub strong">${i.subtype || i.type}</span>
            ${i.address ? html`<span class="caption muted">${i.address}</span>` : ""}
            <span class="caption muted">${[cap(i.status), i.submitted ? `reported ${relative(i.submitted)}` : null].filter(Boolean).join(" · ")}</span></span>
          <span class="caption muted mono">${distance(d)}</span></button>`)}</div>
        ${rows.length > shown.length ? html`<p class="caption muted">Showing the ${shown.length} nearest of ${rows.length}.</p>` : ""}`}
      </section>`}
    </div>`);
  };

  const paint = () => { paintChrome(); paintMap(); paintList(); };
  const load = (force = false) => loadMap(center, status, force);

  // ---------- events ----------
  off(on(main, "click", "[data-status]", (e, b) => { status = b.dataset.status; sessionStorage.setItem("mapStatus", status); selected = null; paint(); load(); }));
  off(on(main, "change", "#scope", (e) => { scopeDays = Number(e.target.value); local.set("mapScopeDays", scopeDays); selected = null; paint(); }));
  off(on(main, "click", "#refresh", () => load(true)));
  off(on(main, "click", "#only", () => { onlyMine = !onlyMine; local.set("onlyMine", onlyMine); selected = null; paint(); }));
  off(on(main, "click", "#me", async () => { const p = await current(); if (p && m) { showMe(p); m.map.easeTo({ center: [p.lng, p.lat] }); } }));
  off(on(main, "click", "#mode", async () => {
    listMode = !listMode;
    local.set("nearbyList", listMode);
    selected = null;
    $("#map").hidden = listMode;
    $("#list").hidden = !listMode;
    $("#me").hidden = listMode;
    render($("#mode"), icon(listMode ? "map" : "list"));
    $("#mode").setAttribute("aria-label", listMode ? "Show map" : "Show list");
    if (!listMode) { await startMap(); m?.map.resize(); }
    paint();
  }));
  off(on(main, "click", "[data-close-pin]", () => { selected = null; paintMap(); paintChrome(); }));
  off(on(main, "click", "[data-details]", () => selected && publicDetail(selected)));
  off(on(main, "click", "[data-pub]", (e, b) => { const i = issues().find((x) => x.id === b.dataset.pub); if (i) publicDetail(i); }));
  off(wireRequestUpdates(main, (id) => { const i = issues().find((x) => x.id === id); return i ? asTarget(i) : null; }));
  off(listen("map", paint), listen("mine", paint), listen("detail", paintList), listen("queue", paintList));

  // A tapped alert opens its report (the service worker sends the path).
  paint();
  startMap();
  (async () => {
    const here = listMode ? await currentIfAllowed() : null;
    if (here) center = here;
    load();
    loadMyReports();
  })();
  return off.run;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

/** The selected pin. Text wraps; nothing is cut off. */
function pinCard(i) {
  return html`<div class="pin-card stack s8" style="--stage:${stageVar(i.status)}" role="region" aria-label="Selected report">
    <div class="row top">
      <div class="grow stack s4"><p class="headline">${i.subtype || i.type}</p>${i.subtype ? html`<p class="sub muted">${i.type}</p>` : ""}</div>
      <button class="btn text" type="button" data-close-pin aria-label="Close" style="padding:0;width:44px">${icon("close")}</button>
    </div>
    <div>${statusChip(i.status)}</div>
    <div class="row s8 sub">${icon("location_on")}<span>${i.address}</span></div>
    ${i.details ? html`<p class="sub muted prewrap">${i.details}</p>` : ""}
    <p class="caption muted">${[i.caseNumber ? `#${i.caseNumber}` : null, i.submitted ? `reported ${shortDate(new Date(i.submitted))}` : null,
      i.updated ? `updated ${relative(i.updated)}` : null].filter(Boolean).join(" · ")}</p>
    <div class="row wrap">
      <button class="btn tonal" type="button" data-details>${icon("description")}<span>Full details</span></button>
      ${stage(i.status) !== 3 ? requestUpdateButton(asTarget(i)) : ""}
    </div>
  </div>`;
}

/** A public report's detail: photos, description, staff timeline. The reporter's contact fields are never read. */
function publicDetail(i) {
  const t = asTarget(i);
  let detail = cachedFullDetail(t), error = null;
  const body = () => html`<div class="stack">
    <div class="card stack s8">
      <div>${statusChip(detail?.status || i.status)}</div>
      <p class="title2">${i.subtype || i.type}</p>
      ${i.subtype ? html`<p class="sub muted">${i.type}</p>` : ""}
      <div class="row s8 sub">${icon("location_on")}<span>${i.address}</span></div>
      ${track(detail?.status || i.status, detail?.timeline || [])}
    </div>
    ${detail ? html`
      ${detail.photos.length ? html`<div class="strip">${detail.photos.map((u, n) => html`<a class="thumb big" href="${safeUrl(u)}" target="_blank" rel="noopener"><img src="${u}" alt="Photo ${n + 1}" loading="lazy"></a>`)}</div>` : ""}
      ${(detail.description || i.details) ? html`<p class="card sub prewrap">${detail.description || i.details}</p>` : ""}
      ${detail.timeline.length ? html`<h3 class="label">Timeline</h3><div class="card stack s12">${[...detail.timeline].reverse().map((e) => html`
        <div class="stack s4"><p class="sub strong">${e.title}</p>${e.details ? html`<p class="sub muted prewrap">${e.details}</p>` : ""}<p class="caption muted">${e.when}</p></div>`)}</div>` : ""}`
      : error ? empty({ icon: "cloud_off", title: "Cannot load the details", message: error }) : spinner()}
  </div>`;
  sheet({
    title: i.caseNumber ? `#${i.caseNumber}` : "Report",
    body: body(),
    mount: (el) => {
      let alive = true;
      fullDetail(t).then((d) => { detail = d; }).catch((e) => { if (!detail) error = e.message; })
        .finally(() => { if (alive) render(el, body()); });
      return () => { alive = false; };
    },
  });
}

