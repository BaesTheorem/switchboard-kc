// Shared screen pieces: the title, the snackbar, the bottom sheet, confirm
// dialogs, the repair banner, and the components every tab draws (status
// track, status chip, empty states).

import { $, esc, html, icon, on, raw, render } from "./lib/html.js";
import { STAGES, stage } from "./models.js";

export function setTitle(text) {
  $("#title").textContent = text;
  document.title = text === "Switchboard KC" ? text : `${text} · Switchboard KC`;
}

let snackTimer;
export function snack(text, ms = 4000) {
  const el = $("#snack");
  el.textContent = text;
  el.classList.add("active");
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove("active"), ms);
}

export function banner(text) {
  const el = $("#banner");
  if (!text) { el.replaceChildren(); return; }
  render(el, html`<progress class="circle small" aria-hidden="true"></progress><span>${text}</span>`);
}

// ---------- bottom sheet ----------

let closeCurrent = null;

/**
 * Opens the bottom sheet. `body` is a template; `mount(el, close)` wires it and
 * may return a cleanup. `start`/`end` are header buttons: {label, act}.
 * Returns a close function.
 */
export function sheet({ title = "", body, mount, start = { label: "Close" }, end, onClose }) {
  closeCurrent?.();
  const d = $("#sheet");
  render(d, html`
    <div class="sheet-head">
      <div>${start ? html`<button class="btn text" data-sheet="start" type="button">${start.label}</button>` : ""}</div>
      <h2 id="sheet-title">${title}</h2>
      <div class="end">${end ? html`<button class="btn text strong" data-sheet="end" type="button" ${end.disabled ? "disabled" : ""}>${end.label}</button>` : ""}</div>
    </div>
    <div class="sheet-body">${body}</div>`);
  d.setAttribute("aria-labelledby", "sheet-title");
  let cleanup;
  const close = () => {
    if (closeCurrent !== close) return;
    closeCurrent = null;
    try { cleanup?.(); } catch { /* ignore */ }
    if (d.open) d.close();
    d.replaceChildren();
    onClose?.();
  };
  closeCurrent = close;
  d.onclose = () => close();
  d.onclick = (e) => { if (e.target === d) close(); };   // a tap on the backdrop
  d.querySelector('[data-sheet="start"]')?.addEventListener("click", () => (start.act ? start.act(close) : close()));
  d.querySelector('[data-sheet="end"]')?.addEventListener("click", () => end.act(close));
  d.showModal();
  cleanup = mount?.(d.querySelector(".sheet-body"), close);
  return close;
}

export const closeSheet = () => closeCurrent?.();

/** A confirm dialog. Resolves true when the action button is tapped. */
export function confirmDialog({ title, message, ok = "OK", cancel = "Cancel" }) {
  return new Promise((resolve) => {
    let answered = false;
    sheet({
      title,
      start: { label: cancel },
      body: html`<div class="stack s20"><p class="sub prewrap">${message}</p>
        <button class="btn" type="button" data-ok>${ok}</button></div>`,
      mount: (el, close) => {
        el.querySelector("[data-ok]").addEventListener("click", () => { answered = true; close(); resolve(true); });
        el.querySelector("[data-ok]").focus();
      },
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// ---------- components ----------

export const spinner = (label = "Loading") => html`<div class="spinner" role="status"><progress class="circle" aria-label="${label}"></progress></div>`;

/** Empty, loading-failed, and nothing-here states share one layout. `action` is {label, attr}; attr is app-written markup. */
export const empty = ({ icon: name, title, message = "", action }) => html`
  <div class="empty">
    ${icon(name)}
    <p class="headline">${title}</p>
    ${message ? html`<p class="sub muted">${message}</p>` : ""}
    ${action ? html`<button class="btn tonal" type="button" ${raw(action.attr)}>${icon("refresh")}<span>${action.label}</span></button>` : ""}
  </div>`;

/** The four-step track: Sent, Received, In progress, Done. */
export function track(status, timeline = []) {
  const st = stage(status, timeline);
  return html`<div class="track stage-${st}" role="img" aria-label="Status: ${STAGES[st]}">
    <div class="bars">${STAGES.map((_, i) => html`<span class="${i <= st ? "on" : ""}"></span>`)}</div>
    <div class="names" aria-hidden="true">${STAGES.map((n, i) => html`<span class="${i === st ? "now" : ""}">${n}</span>`)}</div>
  </div>`;
}

export function statusChip(status) {
  const st = stage(status);
  const text = status ? status.charAt(0).toUpperCase() + status.slice(1) : "Received";
  return html`<span class="status st-${st}">${text}</span>`;
}

export const stageVar = (status) => ["var(--open)", "var(--open)", "var(--working)", "var(--done)"][stage(status)];

/** A labeled section heading above a card. */
export const label = (text) => html`<h2 class="label">${text}</h2>`;

/** Wires `data-act` buttons inside a root to handlers by name. Returns the remover. */
export function acts(root, handlers) {
  return on(root, "click", "[data-act]", (e, el) => {
    const fn = handlers[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
}

export { esc };
