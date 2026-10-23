// The Report tab's home: photo first (camera, library, or none), Health and
// help, facts for where you are, reports waiting to send, your open
// reports, and the cards that keep them safe (Home Screen app, passkey). Ported from ReportTab.swift and CivicData.swift (NearYou).

import { attrs, KCMO, query, text } from "../lib/arcgis.js";
import { relative } from "../lib/format.js";
import { currentIfAllowed, meters } from "../lib/geo.js";
import { bag, html, icon, render } from "../lib/html.js";
import { local } from "../lib/store.js";
import { draftFor, dropQueued, flushQueue, listen, S, visibleReports } from "../state.js";
import { installCard, wireInstallCard } from "../install.js";
import { acts } from "../ui.js";
import { helpCard } from "./help.js";
import { keepCard, restoreCard, wireKeep } from "./keep.js";
import { photoInputs, reportCard, wirePhotoInputs } from "./parts.js";

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
      ${photoInputs("rp")}
    </section>
    ${helpCard("#/report/help")}
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

  const paintNear = (n) => {
    const box = main.querySelector("#near");
    if (!n || (!n.trashDay && !n.plowed)) { box.replaceChildren(); return; }
    render(box, html`<section class="card stack s12" aria-label="Near you">
      ${n.trashDay ? html`<div class="row top">${icon("delete", "primary-text")}
        <p class="sub">Trash day: ${n.trashDay}${n.zone ? ` · Leaf and brush zone: ${n.zone}` : ""}</p></div>` : ""}
      ${n.plowed ? html`<div class="row top">${icon("ac_unit", "primary-text")}<p class="sub">${n.plowed}</p></div>` : ""}
    </section>`);
  };

  // With reports: keep them (Home Screen, passkey). With none yet: offer a restore from a passkey.
  const paintKeep = () => {
    const box = main.querySelector("#keep");
    if (!box) return;
    render(box, S.myReports.length ? html`${installCard("Keep Switchboard KC on your Home Screen")}${keepCard()}` : restoreCard());
  };

  paintQueued();
  paintRecent();
  paintKeep();
  off(listen("queue", paintQueued), listen("mine", paintRecent), listen("detail", paintRecent), listen("mine", paintKeep),
    wireKeep(main, paintKeep), wireInstallCard(main, paintKeep));
  nearYou().then(paintNear).catch(() => {});
  return off.run;
}

/**
 * Trash day and leaf and brush zone (saved a day, per spot) and recent snow
 * plowing for the device's position. The water outage layer the iPhone app
 * read (maps.kcwater.info) stopped resolving in October 2026, so it is left out.
 */
async function nearYou() {
  const here = await currentIfAllowed();
  if (!here) return null;
  let saved = local.get("nearYou");
  if (!saved || Date.now() - saved.at > 86400e3 || meters(saved, here) > 100) {
    const [trash, zone] = await Promise.all([
      query("https://mapd.kcmo.org/kcgis/rest/services/AGOL/MapServer/5", { near: here }).catch(() => []),
      query(`${KCMO}/Leaf_Brush_Zones/FeatureServer/0`, { near: here }).catch(() => []),
    ]);
    saved = { lat: here.lat, lng: here.lng, at: Date.now(), trashDay: text(attrs(trash[0]), "TRASHDAY"), zone: text(attrs(zone[0]), "ZONE") };
    local.set("nearYou", saved);
  }
  let plowed = "";
  const snow = await query(`${KCMO}/EventSnowRoutes_public_74e8930bc7fb4f2aa30a81bec12d50bc/FeatureServer/0`, { near: here, miles: 0.1, limit: 20 }).catch(() => []);
  const last = Math.max(0, ...snow.map((f) => Number(attrs(f).lastserviced) || 0));
  if (last && Date.now() - last < 3 * 86400e3) plowed = `Your street was plowed ${relative(last)}`;
  return { ...saved, plowed };
}

