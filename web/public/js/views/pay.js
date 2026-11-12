// The Pay screen: each bill, ticket and fee the city takes online, one tap
// from the payment page of the office that owns it. The app takes no card
// numbers. The facts are in ../pay.js, with their source.

import { html, icon, render, safeUrl } from "../lib/html.js";
import { IN_PERSON, PAY_PAGE, PAY_READ, PAYMENTS } from "../pay.js";

export default function pay(main, _params, ctx) {
  ctx.title("Pay");
  render(main, html`
    <div class="screen stack s24 pay">
      <div class="row">
        <div class="avatar">${icon("payments")}</div>
        <div class="grow">
          <div class="headline">Pay a bill or a ticket</div>
          <div class="sub muted">Each one opens the payment page of the office that owns it. This app takes no card numbers.</div>
        </div>
      </div>
      <section class="stack s8" aria-labelledby="pay-h">
        <h2 class="label" id="pay-h">What do you want to pay?</h2>
        <div class="rows" id="pay-list">
          ${PAYMENTS.map((p) => html`<a class="item" href="${safeUrl(p.url)}" target="_blank" rel="noopener">
            ${icon(p.icon)}<span class="grow stack s4" style="gap:2px"><span class="sub">${p.name}</span>
            ${p.note ? html`<span class="caption muted">${p.note}</span>` : ""}</span>${icon("open_in_new", "trail")}</a>`)}
        </div>
      </section>
      <section class="stack s8" aria-labelledby="pay-person">
        <h2 class="label" id="pay-person">In person</h2>
        <div class="card stack s8">${IN_PERSON.map((t) => html`<p class="sub">${t}</p>`)}</div>
      </section>
      <p class="caption muted">From the city's Pay Online page, read ${PAY_READ}.
        <a class="primary-text" href="${safeUrl(PAY_PAGE)}" target="_blank" rel="noopener">See the city's page</a> for the list as it is now.</p>
    </div>`);
}
