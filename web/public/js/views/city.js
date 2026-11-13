// The City tab: Health and help, the Pay card, the city's phone numbers,
// license offices and transit, and the city pages that no Report section
// claims. The search field filters all of it. Ported from CityTab in
// OtherTabs.swift.

import { generalLinks, PHONES_MORE, PHONES_PINNED, phoneHref } from "../catalog.js";
import { isPayLink, PAYMENTS } from "../pay.js";
import { $, bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { linkIcon, linkName } from "../models.js";
import { listen, S } from "../state.js";
import { label } from "../ui.js";
import { follow, helpCard } from "./help.js";

// Kept while the app runs, as the iPhone tab keeps its state when a screen opens on top of it.
let query = "";
let showMore = false;

/** The search rule: case-insensitive, the trimmed query anywhere in the text. An empty query matches all. */
export function matches(q, text) {
  const s = String(q).toLowerCase().trim();
  return !s || String(text).toLowerCase().includes(s);
}

// One keyword line for the License offices and Buses and streetcar rows.
const TRAVEL = "license offices dmv driver license plates title motor vehicle buses streetcar transit ridekc";

const phoneRow = (p) => html`<a class="item" href="${safeUrl(phoneHref(p))}">
  ${icon(p.text ? "sms" : "call")}
  <span class="grow stack s4"><span>${p.name}</span><span class="caption muted mono">${p.number}</span></span>
</a>`;

const linkRow = (l) => html`<a class="item" href="${safeUrl(l.url)}" target="_blank" rel="noopener">
  ${icon(linkIcon(l.name))}<span class="grow">${linkName(l.name)}</span>${icon("open_in_new", "trail")}
</a>`;

// The Pay card opens the app's Pay screen, which has each payment one tap
// away. It takes the place of the city's "Pay Online" link in the list of
// city pages. A search finds it by its name or by the name of a payment.
const PAY_WORDS = `pay a bill or a ticket pay online ${PAYMENTS.map((p) => p.name).join(" ")}`;
const payCard = () => html`<a class="plain door-card" href="#/city/pay" data-go="/city/pay">
  <span class="tile row top">
    ${icon("payments", "primary-text")}
    <span class="grow stack s4">
      <span class="headline">Pay a bill or a ticket</span>
      <span class="caption muted">Water bill, parking and court tickets, taxes, permits, and more.</span>
    </span>
    ${icon("chevron_right", "muted")}
  </span>
</a>`;

function list() {
  // The name and the number are matched as one run of text, as on the iPhone.
  const phone = (p) => matches(query, p.name + p.number);
  const pinned = PHONES_PINNED.filter(phone);
  const more = PHONES_MORE.filter(phone);
  const travel = matches(query, TRAVEL);
  const pay = matches(query, PAY_WORDS);
  const links = generalLinks(S.links).filter((l) => !isPayLink(l) && matches(query, linkName(l.name)));
  // Open while searching, so the matches show.
  const open = showMore || query !== "";
  const count = pinned.length + more.length + (travel ? 2 : 0) + (pay ? 1 : 0) + links.length;
  return {
    count,
    tpl: html`
    ${helpCard("#/city/help")}
    ${pay ? payCard() : ""}
    ${pinned.length || more.length ? html`<section class="stack s8">
      ${label("Phone numbers")}
      <div class="rows">
        ${pinned.map(phoneRow)}
        ${more.length ? html`<details class="more" ${open ? "open" : ""}>
          <summary class="item">${icon("contact_phone")}<span class="grow">More city numbers (${more.length})</span>${icon("expand_more", "trail")}</summary>
          <div class="more-rows">${more.map(phoneRow)}</div>
        </details>` : ""}
      </div>
    </section>` : ""}
    ${travel ? html`<section class="stack s8">
      <div class="rows">
        <a class="item" href="#/city/licenses" data-go="/city/licenses">${icon("badge")}<span class="grow">License offices (DMV)</span>${icon("chevron_right", "trail")}</a>
        <a class="item" href="#/city/transit" data-go="/city/transit">${icon("directions_bus")}<span class="grow">Buses and streetcar</span>${icon("chevron_right", "trail")}</a>
      </div>
      <p class="foot muted">License offices with today's hours, and the next buses and streetcars near you.</p>
    </section>` : ""}
    ${!S.links.length ? html`<section class="stack s8">
      ${label("City pages")}
      <div class="rows"><div class="cell" role="status"><progress class="circle small" aria-hidden="true"></progress><span class="muted">Loading city pages</span></div></div>
    </section>` : links.length ? html`<section class="stack s8">
      ${label("City pages")}
      <div class="rows">${links.map(linkRow)}</div>
      <p class="foot muted">Pages about trash, streets, water, health, and business are in their sections on the Report tab.</p>
    </section>` : ""}`,
  };
}

export default function cityView(main, _params, ctx) {
  render(main, html`<div class="screen city-ui stack s20">
    <form role="search" data-search>
      <label class="field-label" for="city-q">Search numbers and pages</label>
      <div class="search-box">
        ${icon("search")}
        <input class="input" id="city-q" type="search" placeholder="Tow lot, court, water" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
        <button class="icon-btn clear" type="button" aria-label="Clear the search" data-clear hidden>${icon("close")}</button>
      </div>
    </form>
    <p class="visually-hidden" role="status" data-count></p>
    <div class="stack s20" data-list></div>
  </div>`);
  const input = $("#city-q", main);
  const clear = $("[data-clear]", main);
  const listEl = $("[data-list]", main);
  const countEl = $("[data-count]", main);
  input.value = query;

  const paint = () => {
    const { tpl, count } = list();
    render(listEl, tpl);
    clear.hidden = !query;
    countEl.textContent = query.trim() ? (count === 1 ? "1 result" : `${count} results`) : "";
  };
  paint();

  const add = bag();
  add(
    on(main, "input", "#city-q", () => { query = input.value; paint(); }),
    on(main, "submit", "[data-search]", (e) => { e.preventDefault(); input.blur(); }),
    on(main, "click", "[data-clear]", () => { query = ""; input.value = ""; paint(); input.focus(); }),
    // A tap on the row toggles it. `toggle` also fires when the page opens it for a search, so it is not used.
    on(main, "click", "details.more > summary", (_e, s) => { showMore = !s.parentElement.open; }),
    follow(main, ctx.go),
    listen("catalog", paint),
  );
  return add.run;
}
