// One section: its city pages first, then each category as a header with its
// sub-types under it, so look-alike names ("Guardrail" in Bridge and in
// Street Maintenance) show where they go. Ported from SectionView.

import { categoriesIn, linksIn, sectionById } from "../catalog.js";
import { bag, html, icon, render, safeUrl } from "../lib/html.js";
import { linkIcon, linkName, subId, subName } from "../models.js";
import { listen, S } from "../state.js";
import { spinner } from "../ui.js";
import { wirePicks } from "./directory.js";

export default function view(main, params, ctx) {
  const off = bag();
  const sec = sectionById(params.id);
  ctx.title(sec.title);
  const paint = () => {
    if (!S.categories.length) { render(main, spinner()); return; }
    const links = linksIn(S.links, sec);
    render(main, html`<div class="screen stack">
      ${links.length ? html`<section class="stack s8" aria-labelledby="pages-h">
        <h2 class="section-head" id="pages-h">Pages</h2>
        <div class="rows">${links.map((l) => html`<a class="item" href="${safeUrl(l.url)}" target="_blank" rel="noopener">
          ${icon(linkIcon(l.name))}<span class="grow sub">${linkName(l.name)}</span>${icon("open_in_new", "trail")}</a>`)}</div>
      </section>` : ""}
      ${categoriesIn(S.categories, sec).map((c) => html`<section class="stack s8" aria-label="${c.displayName}">
        <h2 class="section-head">${icon(c.icon)}<span>${c.displayName}</span></h2>
        <div class="rows">
          ${c.subs.length ? "" : html`<button class="item" type="button" data-pick="${c.id}/">${icon(c.icon)}<span class="grow sub">${c.displayName}</span>${icon("chevron_right", "trail")}</button>`}
          ${c.subs.map((s) => html`<button class="item" type="button" data-pick="${c.id}/${subId(s)}"><span class="grow sub">${subName(s)}</span>${icon("chevron_right", "trail")}</button>`)}
        </div>
      </section>`)}
    </div>`);
  };
  paint();
  off(wirePicks(main, ctx.tab, ctx.go), listen("catalog", paint));
  return off.run;
}
