// City notices: what the city sends to every phone with its own app (a
// holiday trash delay, for example). The server reads the list and gives it
// as plain text and links (worker/notices.js). The Report tab shows each
// notice until the person hides it; the City tab keeps the list.

import { shortDate } from "../lib/format.js";
import { html, icon, on, safeUrl } from "../lib/html.js";
import { hideNotice, S } from "../state.js";
import { snack } from "../ui.js";

const MONTH = 30 * 86400e3;

/** The notices of the past 30 days, newest first. The saved copy can be older than the server's list. */
export const currentNotices = (now = Date.now()) => (S.notices || []).filter((n) => n && n.id && n.title && n.at > now - MONTH).sort((a, b) => b.at - a.at);

/** A short name for a link: its host and path, with no "www." and no last slash ("kcmo.gov/trash"). */
export function linkLabel(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.slice(0, 60);
  } catch {
    return "Open the page";
  }
}

/** One notice as a card. `hide` adds the button that takes it off the Report tab. */
export function noticeCard(n, { hide = false } = {}) {
  const id = `notice-${String(n.id).replace(/\W/g, "")}`;
  return html`<section class="card stack s8 notice" aria-labelledby="${id}">
    <div class="row top">
      ${icon("campaign", "primary-text")}
      <div class="grow stack s4">
        <h2 class="sub strong" id="${id}">${n.title}</h2>
        <p class="caption muted">From the city, ${shortDate(new Date(n.at))}</p>
      </div>
      ${hide ? html`<button class="icon-btn" type="button" data-hide-notice="${n.id}" aria-label="Hide this notice">${icon("close")}</button>` : ""}
    </div>
    ${n.text ? html`<p class="sub prewrap">${n.text}</p>` : ""}
    ${(n.links || []).length ? html`<div class="row wrap">${n.links.map((l) => html`<a class="btn text" href="${safeUrl(l.url)}" target="_blank" rel="noopener">
      ${icon("open_in_new")}<span>${linkLabel(l.url)}</span></a>`)}</div>` : ""}
  </section>`;
}

/** Wires the hide buttons inside `root`. Returns the remover. */
export function wireNotices(root) {
  return on(root, "click", "[data-hide-notice]", (_e, b) => {
    hideNotice(b.dataset.hideNotice);
    snack("City notices are on the City tab.", 5000);
  });
}
