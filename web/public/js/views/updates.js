// One tap files a "311 Request Update" for each selected open report. The
// screen is the review: it lists every open report and the contact the city
// will use, and the button says how many real requests it sends. Reports
// filed or asked about in the past 7 days are greyed out with the date their
// requests open. The switch turns on the automatic version. Ported from
// RequestUpdates.swift.

import { bag, html, icon, on, render } from "../lib/html.js";
import { local } from "../lib/store.js";
import { autoEnabled, contactSaved, fileUpdateRequest, listen, loadMyReports, S, saveContact, tooSoon, visibleReports } from "../state.js";
import { empty, spinner } from "../ui.js";

export default function view(main, _params, ctx) {
  const off = bag();
  const contact = contactSaved();
  let method = "Email";
  let selected = new Set();
  let touched = false, sending = false, progress = 0;
  const results = {};
  let error = null;

  const open = () => visibleReports().filter((r) => r.isOpen);
  const reach = () => (method === "Email" ? contact.email : contact.phone);
  const done = () => Object.keys(results).length > 0 && !sending;
  const selectDefault = () => { selected = new Set(open().filter((r) => !tooSoon(r)).map((r) => r.id)); };

  const buttonTitle = () => {
    if (sending) return `Sending ${progress} of ${selected.size}`;
    if (!reach()) return method === "Email" ? "Add your email" : "Add your phone";
    const n = selected.size;
    return n === 0 ? "Select a report" : `Request ${n === 1 ? "an update" : `${n} updates`}`;
  };

  const paint = () => {
    const list = open();
    if (!list.length) {
      const loading = S.myState === "loading" || (S.myState === "idle" && !S.myReports.length);
      render(main, html`<div class="screen">${loading ? spinner()
        : S.myState === "failed" ? empty({ icon: "cloud_off", title: "Cannot load your reports", message: S.myError || "", action: { label: "Try again", attr: 'data-retry' } })
          : empty({ icon: "task_alt", title: "No open reports", message: "All the reports you sent are closed." })}
        ${autoSection()}</div>`);
      return;
    }
    render(main, html`<div class="screen stack s20">
      <section class="stack s8" aria-labelledby="or-h"><h2 class="label" id="or-h">Open reports</h2>
        <div class="rows">${list.map((r) => {
          const note = tooSoon(r);
          const on = selected.has(r.id);
          return html`<button class="item" type="button" role="checkbox" aria-checked="${String(on)}" data-sel="${r.id}" ${sending || done() || note ? "disabled" : ""}
            style="align-items:flex-start;${note ? "opacity:.5" : ""}">
            <i aria-hidden="true" class="${on ? "primary-text" : "muted"}">${on ? "check_box" : "check_box_outline_blank"}</i>
            <span class="grow stack s4" style="gap:3px"><span class="sub">${r.label}</span>
              <span class="caption muted">${[r.caseNumber ? `#${r.caseNumber}` : `Report ${r.id}`, r.status ? r.status.charAt(0).toUpperCase() + r.status.slice(1) : null, r.address || null].filter(Boolean).join(" · ")}</span>
              ${note ? html`<span class="row s4 caption open-text">${icon("schedule")}<span>${note}</span></span>` : ""}</span>
            ${results[r.id] ? icon(results[r.id] === "ok" ? "check_circle" : "error", results[r.id] === "ok" ? "done-text" : "error-text") : ""}
          </button>`;
        })}</div>
      </section>
      <section class="stack s8" aria-labelledby="by-h"><h2 class="label" id="by-h">The city contacts you by</h2>
        <div class="card stack s12">
          <div class="seg" role="group" aria-label="Contact method">
            <button type="button" data-method="Email" aria-pressed="${String(method === "Email")}">Email</button>
            <button type="button" data-method="Phone Call" aria-pressed="${String(method !== "Email")}">Phone call</button>
          </div>
          ${method === "Email"
            ? html`<label class="visually-hidden" for="u-email">Email</label><input class="input" id="u-email" type="email" inputmode="email" autocomplete="email" placeholder="Email" value="${contact.email}">`
            : html`<label class="visually-hidden" for="u-phone">Phone</label><input class="input" id="u-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Phone" value="${contact.phone}">`}
        </div>
      </section>
      ${autoSection()}
      ${error ? html`<p class="foot error-text" role="alert">${error}</p>` : ""}
      ${done() ? html`<button class="btn" type="button" data-done>${icon("check")}<span>Done</span></button>`
        : html`<button class="btn" type="button" data-send ${!selected.size || !reach() || sending ? "disabled" : ""}>
          ${sending ? "" : icon("notifications_active")}<span>${buttonTitle()}</span></button>`}
    </div>`);
  };

  const autoSection = () => html`<section class="stack s8">
    <div class="rows"><label class="toggle-row" for="u-auto"><span class="grow sub">Ask automatically</span>
      <span class="switch"><input type="checkbox" id="u-auto" ${autoEnabled() ? "checked" : ""}><span></span></span></label></div>
    <p class="caption muted" style="padding:0 4px">When a report has had no updates and no update request for 7 days, the app asks the city and sends you a notification. It checks when you open the app. It needs your email or phone above.</p>
  </section>`;

  const send = async () => {
    sending = true;
    error = null;
    progress = 0;
    paint();
    for (const r of open().filter((x) => selected.has(x.id))) {
      progress++;
      paint();
      try {
        await fileUpdateRequest(r, method, contact);
        results[r.id] = "ok";
      } catch (e) {
        results[r.id] = "error";
        error = e.message;
      }
    }
    sending = false;
    await loadMyReports();
    paint();
  };

  off(on(main, "click", "[data-sel]", (e, b) => {
    touched = true;
    const id = b.dataset.sel;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    paint();
  }));
  off(on(main, "click", "[data-method]", (e, b) => { method = b.dataset.method; paint(); }));
  off(on(main, "input", "#u-email, #u-phone", (e) => {
    if (e.target.id === "u-email") contact.email = e.target.value.trim(); else contact.phone = e.target.value.trim();
    saveContact(contact);
    const b = main.querySelector("[data-send]");
    if (b) { b.disabled = !selected.size || !reach() || sending; b.querySelector("span").textContent = buttonTitle(); }
  }));
  off(on(main, "change", "#u-auto", (e) => {
    local.set("autoRequestUpdates", e.target.checked);
    if (e.target.checked && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }));
  off(on(main, "click", "[data-send]", send));
  off(on(main, "click", "[data-done]", () => { for (const k of Object.keys(results)) delete results[k]; progress = 0; selectDefault(); paint(); }));
  off(on(main, "click", "[data-retry]", () => loadMyReports()));
  off(listen("mine", () => { if (!touched && !sending && !done()) selectDefault(); paint(); }));
  selectDefault();
  paint();
  loadMyReports();
  ctx.title("Request updates");
  return off.run;
}
