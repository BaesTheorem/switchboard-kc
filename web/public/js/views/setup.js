// The two things a person can tell the app about themselves: a home address
// (for the trash day, the leaf and brush zone and the plow line on the Report
// tab) and contact details (they go to the city with a report, so staff can
// answer). The app stores both on this device only. The Report tab asks for
// them with a card; Settings > Your details changes them.
//
// The Report tab used to show the trash day for wherever the device was, with
// no place named. Away from home that was another street's trash day. Now the
// facts are for an address the person set, and the card names it.

import { html, icon, raw } from "../lib/html.js";
import { local } from "../lib/store.js";
import { contactSaved, emit, saveContact } from "../state.js";
import { sheet, snack } from "../ui.js";
import { pickLocation } from "./picker.js";

export const SETTINGS_HINT = "You can add them anytime in Settings, under Your details.";

/** The home address the person set: { lat, lng, street, zip }, or null. */
export function homePlace() {
  const h = local.get("home");
  return h && Number.isFinite(h.lat) && Number.isFinite(h.lng) ? h : null;
}

/** The saved contact details on one line ("Ada Lovelace · ada@example.org"), or "". */
export function contactLine(c = contactSaved()) {
  return [[c.firstName, c.lastName].filter(Boolean).join(" "), c.email, c.phone].map((s) => String(s || "").trim()).filter(Boolean).join(" · ");
}

/** Opens the map to set the home address. True when the person chose a spot. */
export async function setHome() {
  const h = homePlace();
  const p = await pickLocation(h ? { lat: h.lat, lng: h.lng } : undefined);
  if (!p) return false;
  local.set("home", { lat: p.lat, lng: p.lng, street: p.street || "", zip: p.zip || "" });
  local.del("nearYou");
  emit("setup");
  return true;
}

/** Opens the contact details in a sheet. */
export function editContact() {
  const c = contactSaved();
  const field = (id, label, value, more) => html`<div class="grow"><label class="caption muted" for="${id}">${label}</label>
    <input class="input" id="${id}" value="${value}" ${raw(more)}></div>`;
  sheet({
    title: "Contact details",
    start: { label: "Cancel" },
    end: {
      label: "Save",
      act: (close) => {
        const v = (id) => document.getElementById(id).value.trim();
        saveContact({ firstName: v("me-first"), lastName: v("me-last"), email: v("me-email"), phone: v("me-phone") });
        close();
        emit("setup");
        snack("Saved on this device.");
      },
    },
    body: html`<div class="stack s12">
      <p class="sub muted">These go to the city with a report that you send, so staff can answer you. This app stores them on this device only. You can still send a report with no name.</p>
      <div class="row top">${field("me-first", "First name", c.firstName, 'autocomplete="given-name"')}${field("me-last", "Last name", c.lastName, 'autocomplete="family-name"')}</div>
      ${field("me-email", "Email", c.email, 'type="email" inputmode="email" autocomplete="email"')}
      ${field("me-phone", "Phone", c.phone, 'type="tel" inputmode="tel" autocomplete="tel"')}
    </div>`,
  });
}

/** The Report tab's card that asks for the two, or "" when both are set or the person closed it. */
export function setupCard() {
  const h = homePlace(), c = contactLine();
  if ((h && c) || local.get("setupCardClosed")) return "";
  const done = (label, value) => html`<div class="row top">${icon("check_circle", "done-text")}<p class="sub grow">${label}: ${value}</p></div>`;
  return html`<section class="card stack s12" style="text-align:left" aria-labelledby="setup-h">
    <div class="row">${icon("home", "primary-text")}<h2 class="sub strong grow" id="setup-h">Set your address and contact details</h2></div>
    <p class="caption muted">Your address shows your trash day, your leaf and brush zone, and when your street was plowed. Your contact details go to the city with a report, so staff can answer you. This app stores both on this device only.</p>
    ${h ? done("Address", h.street || "set") : html`<button class="btn tonal" type="button" data-setup="home">${icon("location_on")}<span>Set your address</span></button>`}
    ${c ? done("Contact", c) : html`<button class="btn tonal" type="button" data-setup="contact">${icon("person")}<span>Add your contact details</span></button>`}
    <button class="btn text" type="button" data-setup="close">Not now</button>
  </section>`;
}

/** Wires every [data-setup] button inside `root`. Returns the remover. */
export function wireSetup(root) {
  const click = async (e) => {
    const b = e.target.closest("[data-setup]");
    if (!b || !root.contains(b)) return;
    const act = b.dataset.setup;
    if (act === "home") await setHome();
    else if (act === "contact") editContact();
    else if (act === "close") { local.set("setupCardClosed", Date.now()); emit("setup"); snack(SETTINGS_HINT, 6000); }
  };
  root.addEventListener("click", click);
  return () => root.removeEventListener("click", click);
}
