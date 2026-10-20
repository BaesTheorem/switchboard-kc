// Pieces more than one screen draws: my report card, the photo pickers,
// and the request-update button.

import { html, icon, on } from "../lib/html.js";
import { relative } from "../lib/format.js";
import { categoryIcon } from "../models.js";
import { cachedDetail, contactSaved, fileUpdateRequest, lastAsked, loadMyReports, reference, saveContact, tooSoon } from "../state.js";
import { sheet, snack, track } from "../ui.js";

/** One of my reports as a card: type, status track, number, last movement. */
export function reportCard(r, href) {
  const asked = lastAsked(r);
  return html`<a class="plain tile" href="${href}">
    <div class="stack s8">
      <div class="row base">
        ${icon(categoryIcon(r.category), "primary-text")}
        <span class="headline grow">${r.label}</span>
        ${r.unread > 0 ? html`<span class="badge-x">${r.unread} new</span>` : ""}
        ${icon("chevron_right", "muted")}
      </div>
      ${track(r.status, cachedDetail(r.id)?.timeline || [])}
      <div class="row caption muted">
        <span class="grow mono">${r.caseNumber ? `#${r.caseNumber}` : `Report ${r.id}`}</span>
        ${r.lastMovement ? html`<span>updated ${relative(r.lastMovement)}</span>` : ""}
      </div>
      ${asked ? html`<div class="row s4 caption primary-text">${icon("notifications_active")}<span>Update asked ${relative(asked)}</span></div>` : ""}
    </div>
  </a>`;
}

/** Hidden file inputs for the camera and the photo library. `pick(file)` runs for each chosen photo. */
export function photoInputs(id) {
  return html`
    <input type="file" accept="image/*" capture="environment" id="${id}-camera" class="visually-hidden" tabindex="-1" aria-hidden="true">
    <input type="file" accept="image/*" id="${id}-library" class="visually-hidden" tabindex="-1" aria-hidden="true" multiple>`;
}

export function wirePhotoInputs(root, id, pick) {
  const handler = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    for (const f of files.slice(0, 4)) {
      try { await pick(f); } catch (err) { snack(err.message || "Could not read the photo."); }
    }
  };
  const cam = root.querySelector(`#${id}-camera`);
  const lib = root.querySelector(`#${id}-library`);
  cam.addEventListener("change", handler);
  lib.addEventListener("change", handler);
  return {
    camera: () => cam.click(),
    library: () => lib.click(),
    off: () => { cam.removeEventListener("change", handler); lib.removeEventListener("change", handler); },
  };
}

// ---------- request update ----------

const methodFor = (c) => (c.email ? "Email" : "Phone Call");
const reachFor = (c) => (c.email ? c.email : c.phone);

/** "Request update" for one report (mine or a public pin). Files a REAL 311 Request Update, so it confirms first. */
export function requestUpdateButton(t) {
  const blocked = tooSoon(t);
  return html`<div class="stack s4" data-ru="${t.id}">
    <button class="btn tonal" type="button" data-act="request-update" ${blocked ? "disabled" : ""}>
      ${icon("notifications_active")}<span>Request update</span></button>
    ${blocked ? html`<div class="row s4 caption open-text">${icon("schedule")}<span>${blocked}</span></div>` : ""}
    <p class="caption error-text" data-ru-error hidden></p>
  </div>`;
}

/** Handles the button's tap: asks for a contact when none is saved, confirms, then files. */
export async function requestUpdate(t, el) {
  const box = el.closest("[data-ru]");
  let contact = contactSaved();
  if (!reachFor(contact)) {
    const ok = await askContact();
    if (!ok) return;
    contact = contactSaved();
  }
  const method = methodFor(contact);
  const go = await new Promise((resolve) => {
    let answered = false;
    sheet({
      title: "Ask the city for an update?",
      start: { label: "Cancel" },
      body: html`<div class="stack s20">
        <p class="sub">This files a 311 Request Update on ${reference(t)} (${t.label}). The city contacts you by ${method === "Email" ? "email at" : "phone at"} ${reachFor(contact)}.</p>
        <button class="btn" type="button" data-ok>${icon("notifications_active")}<span>Request update</span></button></div>`,
      mount: (root, close) => {
        root.querySelector("[data-ok]").addEventListener("click", () => { answered = true; close(); resolve(true); });
      },
      onClose: () => { if (!answered) resolve(false); },
    });
  });
  if (!go) return;
  const btn = box.querySelector("button");
  btn.disabled = true;
  btn.querySelector("span").textContent = "Sending";
  try {
    await fileUpdateRequest(t, method, contact);
    box.innerHTML = String(html`<div class="row s8 sub strong done-text" style="min-height:44px">${icon("check_circle")}<span>Update requested</span></div>`);
    await loadMyReports();
  } catch (e) {
    btn.disabled = false;
    btn.querySelector("span").textContent = "Request update";
    const err = box.querySelector("[data-ru-error]");
    err.textContent = e.message;
    err.hidden = false;
  }
}

/** Asks once for the contact the city uses to answer update requests. */
export function askContact() {
  return new Promise((resolve) => {
    let saved = false;
    const c = contactSaved();
    sheet({
      title: "How should the city reach you?",
      start: { label: "Cancel" },
      end: { label: "Continue", act: (close) => {
        const root = document.querySelector("#sheet");
        const email = root.querySelector("#ac-email").value.trim();
        const phone = root.querySelector("#ac-phone").value.trim();
        if (!email && !phone) { root.querySelector("#ac-email").focus(); return; }
        saveContact({ ...contactSaved(), email, phone });
        saved = true;
        close();
        resolve(true);
      } },
      body: html`<div class="stack s12">
        <label class="field-label" for="ac-email">Email</label>
        <input class="input" id="ac-email" type="email" autocomplete="email" inputmode="email" value="${c.email}">
        <label class="field-label" for="ac-phone">Phone</label>
        <input class="input" id="ac-phone" type="tel" autocomplete="tel" inputmode="tel" value="${c.phone}">
        <p class="foot muted">The city answers update requests by email, or by phone if no email is given. Saved on this device only.</p>
      </div>`,
      onClose: () => { if (!saved) resolve(false); },
    });
  });
}

/** Wires every request-update button inside root. `targetFor(id)` returns the target for a button. */
export function wireRequestUpdates(root, targetFor) {
  return on(root, "click", '[data-act="request-update"]', (e, el) => {
    const t = targetFor(el.closest("[data-ru]").dataset.ru);
    if (t && !el.disabled) requestUpdate(t, el);
  });
}
