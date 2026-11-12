// The Report tab's home: photo first (camera, library, or none), Health and
// help, the card that asks for an address and contact details, facts for
// that address, reports waiting to send, your open reports, and the cards
// that keep them safe (Home Screen app, passkey). Ported from ReportTab.swift
// and CivicData.swift (NearYou), which read the device's position instead.

import { attrs, KCMO, query, text } from "../lib/arcgis.js";
import { relative } from "../lib/format.js";
import { meters } from "../lib/geo.js";
import { bag, html, icon, render } from "../lib/html.js";
import { local } from "../lib/store.js";
import { lastPlowed } from "../models.js";
import { draftFor, dropQueued, flushQueue, listen, S, visibleReports } from "../state.js";
import { installCard, wireInstallCard } from "../install.js";
import { acts } from "../ui.js";
import { helpCard } from "./help.js";
import { keepCard, restoreCard, wireKeep } from "./keep.js";
import { photoInputs, reportCard, wirePhotoInputs } from "./parts.js";
import { homePlace, setupCard, wireSetup } from "./setup.js";

export default function view(main, _params, ctx) {
  const off = bag();
  const draft = draftFor("report");
  render(main, html`<div class="screen stack s20">
    <section class="hero stack" aria-labelledby="hero-title">
      ${icon("add_a_photo")}
      <h2 class="title2" id="hero-title">Report a problem</h2>
      <p class="sub muted">Take a photo, pick what is wrong, confirm the spot. The city gets it in under a minute.</p>
      <button class="btn" type="button" data-act="camera">${icon("photo_camera")}<span>Take a photo</span></button>
      <div class="row">
        <button class="btn soft grow" type="button" data-act="library">${icon("photo_library")}<span>Library</span></button>
        <a class="btn soft grow" href="#/services">No photo</a>
      </div>
      <p class="foot muted">Unofficial. Not a City of Kansas City service.</p>
      ${photoInputs("rp")}
    </section>
    ${helpCard("#/report/help")}
    <div id="setup"></div>
    <div id="near"></div>
    <div id="queued"></div>
    <div id="recent"></div>
    <div id="keep" class="stack s12"></div>
  </div>`);

  const pickers = wirePhotoInputs(main, "rp", async (file) => {
    draft.reset();
    await draft.addPhoto(file);
    ctx.go("/report/what");
  });
  off(pickers.off);
  off(acts(main, {
    camera: () => pickers.camera(),
    library: () => pickers.library(),
    retry: () => flushQueue(),
    drop: (el) => dropQueued(el.dataset.id),
  }));

  const paintQueued = () => {
    const box = main.querySelector("#queued");
    if (!S.queued.length) { box.replaceChildren(); return; }
    const failed = S.queued.filter((q) => q.error);
    render(box, html`<div class="card row">
      ${icon("cloud_upload", "open-text")}
      <div class="grow stack s4">
        <p class="sub strong">${S.queued.length} waiting to send</p>
        <p class="caption muted">They go out when the city's server answers again.</p>
        ${failed.map((q) => html`<p class="caption error-text">${q.title}: ${q.error}
          <button class="link" type="button" data-act="drop" data-id="${q.id}">Remove</button></p>`)}
      </div>
      <button class="btn text" type="button" data-act="retry">Retry</button>
    </div>`);
  };

  /** Open reports first (newest first); each opens its detail. */
  const paintRecent = () => {
    const open = visibleReports().filter((r) => r.isOpen).sort((a, b) => (b.added?.getTime() || 0) - (a.added?.getTime() || 0));
    const box = main.querySelector("#recent");
    if (!open.length) { box.replaceChildren(); return; }
    render(box, html`<section class="stack s12" aria-labelledby="recent-h">
      <div class="row">
        <h2 class="label grow" id="recent-h">${open.length === 1 ? "Your open report" : "Your open reports"}</h2>
        <a class="link" href="#/reports">See all</a>
      </div>
      ${open.slice(0, 5).map((r) => reportCard(r, `#/report/mine/${r.id}`))}
      ${open.length > 5 ? html`<a class="link" href="#/reports">See all ${open.length} open reports</a>` : ""}
    </section>`);
  };

  // Facts for the address the person set, under its name. No address, no facts:
  // the trash day of wherever the device is now would be another street's.
  const paintNear = (n) => {
    const box = main.querySelector("#near");
    const h = homePlace();
    if (!box) return;
    if (!h) { box.replaceChildren(); return; }
    render(box, html`<section class="card stack s12" aria-labelledby="near-h">
      <div class="row">${icon("home", "primary-text")}<h2 class="sub strong grow" id="near-h">${h.street || "Your address"}</h2>
        <button class="link" type="button" data-setup="home">Change</button></div>
      ${!n ? html`<p class="caption muted">Finding your trash day</p>` : ""}
      ${n?.trashDay ? html`<div class="row top">${icon("delete", "primary-text")}
        <p class="sub">Trash day: ${n.trashDay}${n.zone ? ` · Leaf and brush zone: ${n.zone}` : ""}</p></div>` : ""}
      ${n && !n.trashDay ? html`<p class="caption muted">The city's map has no trash day for this spot. It covers Kansas City, Missouri.</p>` : ""}
      ${n?.plowed ? html`<div class="row top">${icon("ac_unit", "primary-text")}<p class="sub">${n.plowed}</p></div>` : ""}
    </section>`);
  };
  // The trash day shows as soon as it is known; the plow line follows.
  const spot = (h) => (h ? `${h.lat},${h.lng}` : "");
  let nearFor = null;
  const loadNear = async () => {
    const h = homePlace(), mine = spot(h);
    nearFor = mine;
    paintNear(null);
    if (!h) return;
    const facts = await trashFacts(h).catch(() => ({}));
    if (mine !== nearFor) return;
    paintNear(facts);
    const plowed = await plowLine(h).catch(() => "");
    if (mine === nearFor && plowed) paintNear({ ...facts, plowed });
  };
  const paintSetup = () => { const box = main.querySelector("#setup"); if (box) render(box, setupCard()); };

  // The passkey card stays until the person saves or closes it. With reports,
  // the Home Screen card joins it; with none yet, a restore from a passkey does.
  const paintKeep = () => {
    const box = main.querySelector("#keep");
    if (!box) return;
    render(box, html`${S.myReports.length ? installCard("Keep Switchboard KC on your Home Screen") : restoreCard()}${keepCard()}`);
  };

  paintQueued();
  paintRecent();
  paintKeep();
  paintSetup();
  off(listen("queue", paintQueued), listen("mine", paintRecent), listen("detail", paintRecent), listen("mine", paintKeep),
    listen("setup", () => { paintSetup(); if (spot(homePlace()) !== nearFor) loadNear(); }),
    wireKeep(main, paintKeep), wireInstallCard(main, paintKeep), wireSetup(main));
  loadNear();
  return off.run;
}

/**
 * Trash day and leaf and brush zone for a spot (saved a day, per spot). The
 * water outage layer the iPhone app read (maps.kcwater.info) stopped
 * resolving in October 2026, so it is left out.
 */
async function trashFacts(here) {
  let saved = local.get("nearYou");
  if (!saved || Date.now() - saved.at > 86400e3 || meters(saved, here) > 100) {
    const [trash, zone] = await Promise.all([
      query("https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/5", { near: here }).catch(() => []),
      query(`${KCMO}/Leaf_Brush_Zones/FeatureServer/0`, { near: here }).catch(() => []),
    ]);
    saved = { lat: here.lat, lng: here.lng, at: Date.now(), trashDay: text(attrs(trash[0]), "TRASHDAY"), zone: text(attrs(zone[0]), "ZONE") };
    local.set("nearYou", saved);
  }
  return saved;
}

/** "Your street was plowed 2 hours ago" for a spot, or "" with no pass in the last 3 days. */
async function plowLine(here) {
  const snow = await query(`${KCMO}/EventSnowRoutes_public_74e8930bc7fb4f2aa30a81bec12d50bc/FeatureServer/0`, { near: here, miles: 0.1, limit: 20 }).catch(() => []);
  const last = lastPlowed(snow.map(attrs));
  return last && Date.now() - last < 3 * 86400e3 ? `Your street was plowed ${relative(last)}` : "";
}

