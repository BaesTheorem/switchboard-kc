// The A to Z rows (report types, city pages, phone numbers, the streetcar),
// with a letter header per group, and what a tap on a row does. Ported from
// DirectoryRows in ReportBrowse.swift and `open(_:)` in ReportTab.swift.

import { directory, itemKey, phoneHref } from "../catalog.js";
import { html, icon, on, safeUrl } from "../lib/html.js";
import { draftFor, S } from "../state.js";
import { empty } from "../ui.js";

export const allItems = () => directory(S.categories, S.links);

function filter(items, query) {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.title.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q)) : items;
}

function row(it, tab) {
  const inner = html`${icon(it.icon)}<span class="grow stack s4" style="gap:2px"><span class="sub">${it.title}</span>
    <span class="caption muted">${it.detail}</span></span>`;
  if (it.kind === "link") return html`<a class="item" href="${safeUrl(it.link.url)}" target="_blank" rel="noopener">${inner}${icon("open_in_new", "trail")}</a>`;
  if (it.kind === "phone") return html`<a class="item" href="${safeUrl(phoneHref(it.phone))}">${inner}</a>`;
  if (it.kind === "streetcar") return html`<a class="item" href="#/${tab}/streetcar">${inner}${icon("chevron_right", "trail")}</a>`;
  return html`<button class="item" type="button" data-pick="${itemKey(it)}">${inner}${icon("chevron_right", "trail")}</button>`;
}

export function directoryRows(items, query, tab) {
  const shown = filter(items, query);
  if (!shown.length) return empty({ icon: "search_off", title: "No match", message: "Try a shorter word." });
  const groups = new Map();
  for (const it of shown) {
    const ch = it.title.charAt(0).toUpperCase();
    const k = /[A-Z]/.test(ch) ? ch : "#";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return html`<div class="stack s12">${[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([letter, rows]) => html`
    <section aria-label="${letter}">
      <h2 class="letter" aria-hidden="true">${letter}</h2>
      <div class="rows">${rows.map((r) => row(r, tab))}</div>
    </section>`)}</div>`;
}

/** Starts a report of one type: the tab's draft gets the type, then the details form opens. */
export function openReport(tab, cat, sub, go) {
  const draft = draftFor(tab);
  draft.setCategory(cat, sub);
  go(`/${tab}/form`);
}

/** Wires the report-type rows inside root. */
export function wirePicks(root, tab, go) {
  return on(root, "click", "[data-pick]", (e, el) => {
    e.preventDefault();
    const [catId, subId] = el.dataset.pick.split("/");
    const cat = S.categories.find((c) => c.id === catId);
    if (!cat) return;
    const sub = subId ? cat.subs.find((s) => (s.subcat_id || s.cat_id) === subId) || null : null;
    openReport(tab, cat, sub, go);
  });
}
