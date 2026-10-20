// One of my reports: status, number, type, place, the status track, the
// request-update button, photos, description, and the staff timeline (with
// update requests merged in). Ported from ReportDetailView.

import { bag, html, icon, render, safeUrl } from "../lib/html.js";
import { cachedFullDetail, fullDetail, listen, loadMyReports, S, visibleReports } from "../state.js";
import { acts, empty, spinner, statusChip, track } from "../ui.js";
import { requestUpdateButton, wireRequestUpdates } from "./parts.js";

export default function view(main, params, ctx) {
  const off = bag();
  const id = params.id;
  let detail = null, error = null;
  const report = () => S.myReports.find((r) => r.id === id);

  const paint = () => {
    const r = report();
    ctx.title(r ? (r.caseNumber ? `#${r.caseNumber}` : `Report ${r.id}`) : `Report ${id}`);
    if (!detail) {
      render(main, html`<div class="screen">${error
        ? empty({ icon: "cloud_off", title: "Cannot load this report", message: error, action: { label: "Try again", attr: 'data-act="retry"' } })
        : spinner()}</div>`);
      return;
    }
    const d = detail;
    render(main, html`<div class="screen stack s20">
      <section class="card stack s12">
        <div class="row">${statusChip(d.status)}<span class="grow"></span>
          ${d.caseNumber ? html`<span class="mono muted" style="user-select:text">#${d.caseNumber}</span>` : ""}</div>
        <h2 class="title2">${d.subtype || d.type}</h2>
        ${d.address ? html`<div class="row s8 sub">${icon("location_on")}<span>${d.address}</span></div>` : ""}
        ${track(d.status, d.timeline)}
        ${r?.isOpen ? requestUpdateButton(r) : ""}
      </section>
      ${d.photos.length ? html`<div class="strip">${d.photos.map((u, i) => html`<a class="thumb big" href="${safeUrl(u)}" target="_blank" rel="noopener">
        <img src="${u}" alt="Photo ${i + 1} of the report" loading="lazy"></a>`)}</div>` : ""}
      ${d.description ? html`<p class="card sub prewrap">${d.description}</p>` : ""}
      ${d.timeline.length ? html`<section class="stack s8" aria-labelledby="tl-h"><h2 class="label" id="tl-h">Timeline</h2>
        <ol class="card timeline" style="list-style:none;margin:0">${[...d.timeline].reverse().map((e) => html`<li class="entry">
          <span class="rail" aria-hidden="true"><b></b><s></s></span>
          <div class="body stack s4"><p class="sub strong">${e.title}</p>
            ${e.details ? html`<p class="sub muted prewrap">${e.details}</p>` : ""}
            <p class="caption muted">${e.when}</p></div></li>`)}</ol>
      </section>` : ""}
    </div>`);
  };

  const load = async () => {
    const r = report() || { id, caseNumber: "" };
    if (!detail) detail = cachedFullDetail(r);
    paint();
    try {
      detail = await fullDetail(r);
      error = null;
    } catch (e) {
      if (!detail) error = e.message;
    }
    if (main.isConnected) paint();
  };

  off(acts(main, { retry: load }));
  off(wireRequestUpdates(main, (rid) => visibleReports().find((x) => x.id === rid)));
  off(listen("mine", paint));
  if (!S.myReports.length) loadMyReports();
  load();
  return off.run;
}
