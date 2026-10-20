// What is wrong? The KC Streetcar shortcut, the A to Z list, then the nine
// sections. The Services tab shows it as its home ("No photo" lands here);
// the Report tab shows it after a photo, with the photo on top. Ported from
// SectionGrid in ReportBrowse.swift.

import { sectionsFor } from "../catalog.js";
import { bag, html, icon, on, render } from "../lib/html.js";
import { draftFor, listen, refreshCatalog, S } from "../state.js";
import { acts, empty, spinner } from "../ui.js";
import { allItems, directoryRows, wirePicks } from "./directory.js";

export default function view(main, _params, ctx) {
  const off = bag();
  const tab = ctx.tab;
  const draft = draftFor(tab);
  let query = "";
  render(main, html`<div class="screen stack">
    <div id="photo"></div>
    <div class="field border round prefix small no-margin">
      <i aria-hidden="true">search</i>
      <input id="q" type="search" placeholder="Pothole, streetlight, tow lot" aria-label="Search report types, pages, and phone numbers" autocomplete="off" enterkeyhint="search">
    </div>
    <div id="body"></div>
  </div>`);
  const body = main.querySelector("#body");

  const paint = () => {
    const last = draft.photos[draft.photos.length - 1];
    render(main.querySelector("#photo"), tab === "report" && last ? html`<img class="photo-banner" src="${last.url}" alt="Your photo">` : "");
    if (query.trim()) { render(body, directoryRows(allItems(), query, tab)); return; }
    if (!S.categories.length) {
      render(body, S.catalogError
        ? empty({ icon: "cloud_off", title: "Cannot load report types", message: S.catalogError, action: { label: "Try again", attr: 'data-act="retry"' } })
        : spinner("Loading report types"));
      return;
    }
    render(body, html`<div class="stack s12">
      <a class="plain tile accent stack s8" href="#/${tab}/streetcar">
        ${icon("tram")}
        <span class="sub strong">KC Streetcar</span>
        <span class="caption muted">On board or at a stop. Goes to the Streetcar Authority, not 311.</span>
      </a>
      <a class="plain card row" href="#/${tab}/all">
        ${icon("sort_by_alpha", "primary-text")}
        <span class="sub strong grow">Everything, A to Z</span>
        <span class="caption muted">${allItems().length}</span>
        ${icon("chevron_right", "muted")}
      </a>
      ${sectionsFor(S.categories).map((s) => html`
        <a class="plain tile row top" href="#/${tab}/section/${s.id}">
          ${icon(s.icon, "primary-text")}
          <span class="grow stack s4"><span class="headline">${s.title}</span><span class="caption muted">${s.blurb}</span></span>
          ${icon("chevron_right", "muted")}
        </a>`)}
    </div>`);
  };

  paint();
  off(on(main, "input", "#q", (e) => { query = e.target.value; paint(); }));
  off(acts(main, { retry: () => refreshCatalog(true) }));
  off(wirePicks(main, tab, ctx.go));
  off(listen("catalog", paint));
  return off.run;
}
