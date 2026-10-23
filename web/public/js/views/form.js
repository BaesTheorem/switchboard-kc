// One page for the details: photos, location, the city's questions, notes,
// visibility and contact. The send button names the first thing still
// missing. Ported from ReportForm.swift.

import { robotToken, warmRobotCheck } from "../robot.js";
import { current } from "../lib/geo.js";
import { bag, html, icon, on, raw, render } from "../lib/html.js";
import { dispose, makeMap } from "../map.js";
import { Kind } from "../models.js";
import {
  checkDuplicate, contactSaved, draftFor, enqueue, loadMyReports, S, saveContact, submit,
} from "../state.js";
import { confirmDialog, snack } from "../ui.js";
import { formatAnswerDate } from "../draft.js";
import { photoInputs, wirePhotoInputs } from "./parts.js";
import { pickLocation } from "./picker.js";

export default function view(main, _params, ctx) {
  const off = bag();
  const draft = draftFor(ctx.tab);
  if (!draft.category) { ctx.go(`/${ctx.tab}`, { replace: true }); return null; }
  const contact = contactSaved();
  let sending = false, locating = false, error = null, mini = null;

  render(main, html`<form class="screen stack s24" id="rf" novalidate>
    <div class="row">
      <span class="avatar">${icon(draft.category.icon)}</span>
      <div class="stack s4"><h2 class="headline">${draft.category.displayName}</h2>
        ${draft.sub ? html`<p class="sub muted">${draft.label}</p>` : ""}</div>
    </div>
    ${draft.disclaimer ? html`<div class="card row top">${icon("info", "primary-text")}<p class="foot muted prewrap">${draft.disclaimer}</p></div>` : ""}
    <section class="stack s8" aria-labelledby="ph-h"><h2 class="label" id="ph-h">Photos</h2><div id="photos"></div>${photoInputs("rf")}</section>
    <section class="stack s8" aria-labelledby="loc-h"><h2 class="label" id="loc-h">${draft.locationRequired ? "Location" : "Location (optional)"}</h2><div id="loc"></div></section>
    ${draft.questions.length ? html`<section class="stack s12" aria-labelledby="q-h"><h2 class="label" id="q-h">The city asks</h2>
      ${draft.questions.map((q, i) => questionField(q, i, draft))}</section>` : ""}
    <section class="stack s8">
      <label class="label" for="rf-notes">${draft.descriptionRequired ? "Description" : "Description (optional)"}</label>
      <textarea class="input" id="rf-notes" rows="4" placeholder="What should the crew know?">${draft.notes}</textarea>
    </section>
    <section class="stack s8" aria-labelledby="vis-h">
      <h2 class="label" id="vis-h">Visibility and contact</h2>
      <div class="rows">
        <label class="toggle-row" for="rf-share">
          <span class="grow stack s4"><span class="sub">Show on the public map</span>
            <span class="caption muted">Neighbors can see the type, place, description, and photos, so they need not report it again.</span></span>
          <span class="switch"><input type="checkbox" id="rf-share" ${draft.share === "public" ? "checked" : ""}><span></span></span>
        </label>
        <label class="toggle-row" for="rf-anon">
          <span class="grow sub">Send anonymously</span>
          <span class="switch"><input type="checkbox" id="rf-anon" ${draft.anonymous ? "checked" : ""}><span></span></span>
        </label>
        <div id="who" class="stack s12" style="padding:16px" ${draft.anonymous ? "hidden" : ""}>
          <div class="row">
            <div class="grow"><label class="caption muted" for="c-first">First name</label><input class="input" id="c-first" autocomplete="given-name" value="${contact.firstName}"></div>
            <div class="grow"><label class="caption muted" for="c-last">Last name</label><input class="input" id="c-last" autocomplete="family-name" value="${contact.lastName}"></div>
          </div>
          <div><label class="caption muted" for="c-email">Email</label><input class="input" id="c-email" type="email" inputmode="email" autocomplete="email" value="${contact.email}"></div>
          <div><label class="caption muted" for="c-phone">Phone</label><input class="input" id="c-phone" type="tel" inputmode="tel" autocomplete="tel" value="${contact.phone}"></div>
          <p class="caption muted">The city uses this to send case updates. It is saved on this device only.</p>
        </div>
      </div>
    </section>
    <div id="turnstile"></div>
    <div id="err" role="alert"></div>
    <button class="btn" type="submit" id="send"></button>
  </form>`);

  const $ = (s) => main.querySelector(s);

  // ---------- photos ----------
  const paintPhotos = () => render($("#photos"), html`<div class="strip">
    ${draft.photos.map((p, i) => html`<div class="thumb"><img src="${p.url}" alt="Photo ${i + 1}">
      <button class="remove" type="button" data-rm="${i}" aria-label="Remove photo ${i + 1}">${icon("close")}</button></div>`)}
    ${draft.photos.length < 4 ? html`
      <button class="thumb add" type="button" data-add="camera" aria-label="Take a photo">${icon("add_a_photo")}</button>
      <button class="thumb add" type="button" data-add="library" aria-label="Add a photo from the library">${icon("photo_library")}</button>` : ""}
  </div>`);
  const pickers = wirePhotoInputs(main, "rf", async (file) => {
    if (draft.photos.length >= 4) return;
    const had = draft.location;
    await draft.addPhoto(file);
    paintPhotos();
    if (draft.location !== had) { paintLocation(); refresh(); }
  });
  off(pickers.off);
  off(on(main, "click", "[data-add]", (e, b) => (b.dataset.add === "camera" ? pickers.camera() : pickers.library())));
  off(on(main, "click", "[data-rm]", (e, b) => { draft.removePhoto(Number(b.dataset.rm)); paintPhotos(); }));

  // ---------- location ----------
  const paintLocation = () => {
    const loc = draft.location, p = draft.place;
    dispose(mini);
    mini = null;
    render($("#loc"), html`<button class="plain card flush" type="button" id="loc-btn">
      ${loc ? html`<div class="mini-map" id="mini" aria-hidden="true" inert></div>` : ""}
      <div class="row" style="padding:16px">
        ${icon("location_on", "primary-text")}
        <span class="grow stack s4"><span class="sub strong">${locating ? "Finding you" : loc?.street || "Set the location"}</span>
          ${p ? html`<span class="caption muted">${p.intersection ? `Near ${p.intersection} · ${p.source}` : p.source}</span>` : ""}</span>
        <span class="sub strong primary-text">Change</span>
      </div>
    </button>`);
    if (loc) {
      makeMap($("#mini"), { center: loc, metersAcross: 300, interactive: false }).then(async (m) => {
        mini = m;
        await m.ready;
        new m.ml.Marker({ color: getComputedStyle(document.body).getPropertyValue("--primary").trim() || "#005ccc" }).setLngLat([loc.lng, loc.lat]).addTo(m.map);
      }).catch(() => {});
    }
  };
  off(() => dispose(mini));
  off(on(main, "click", "#loc-btn", async () => {
    const picked = await pickLocation(draft.location);
    if (!picked) return;
    await draft.setLocation(picked, "pin placed by hand");
    paintLocation();
    refresh();
  }));

  /** After a location change: address, intersection, the description line, and where-questions. */
  const refresh = async () => {
    await draft.refreshPlace();
    paintLocation();
    $("#rf-notes").value = draft.notes;
    for (const q of draft.questions) {
      const el = main.querySelector(`[data-q="${CSS.escape(q.caption)}"]`);
      if (el && q.kind === Kind.text && el.value !== (draft.answers[q.caption] || "")) el.value = draft.answers[q.caption] || "";
    }
    paintSend();
  };

  // ---------- inputs ----------
  off(on(main, "input", "#rf-notes", (e) => { draft.notes = e.target.value; draft.save(); paintSend(); }));
  off(on(main, "change", "#rf-share", (e) => { draft.share = e.target.checked ? "public" : "private"; draft.save(); }));
  off(on(main, "change", "#rf-anon", (e) => { draft.anonymous = e.target.checked; $("#who").hidden = draft.anonymous; draft.save(); }));
  off(on(main, "input", "#who input", () => {
    saveContact({ firstName: $("#c-first").value, lastName: $("#c-last").value, email: $("#c-email").value.trim(), phone: $("#c-phone").value.trim() });
  }));
  off(on(main, "input", "[data-q]", (e) => {
    const el = e.target;
    const q = draft.questions[Number(el.dataset.qi)];
    if (!q) return;
    if ([Kind.date, Kind.time, Kind.dateTime].includes(q.kind)) draft.answers[q.caption] = el.value ? formatAnswerDate(q.kind, parseLocal(el.value, q.kind)) : "";
    else draft.answers[q.caption] = el.value;
    draft.save();
    paintSend();
  }));
  off(on(main, "click", "[data-yes]", (e, b) => {
    const q = draft.questions[Number(b.dataset.qi)];
    draft.answers[q.caption] = b.dataset.yes;
    for (const x of b.parentElement.children) x.setAttribute("aria-pressed", String(x === b));
    draft.save();
  }));
  off(on(main, "click", "[data-opt]", (e, b) => {
    const q = draft.questions[Number(b.dataset.qi)];
    const set = new Set(draft.choiceAnswers[q.caption] || []);
    const id = b.dataset.opt;
    if (set.has(id)) set.delete(id);
    else if (q.multiple) set.add(id);
    else { set.clear(); set.add(id); }
    draft.choiceAnswers[q.caption] = [...set];
    for (const x of b.parentElement.querySelectorAll("[data-opt]")) {
      const onNow = set.has(x.dataset.opt);
      x.setAttribute("aria-pressed", String(onNow));
      x.querySelector("i").textContent = onNow ? "check" : "";
      x.querySelector("i").hidden = !onNow;
    }
    draft.save();
    paintSend();
  }));
  // Date and time questions start at now, as the iPhone's date pickers do.
  for (const [i, q] of draft.questions.entries()) {
    if ([Kind.date, Kind.time, Kind.dateTime].includes(q.kind) && !draft.answers[q.caption]) {
      draft.answers[q.caption] = formatAnswerDate(q.kind, new Date());
      const el = main.querySelector(`[data-qi="${i}"]`);
      if (el) el.value = inputValue(q.kind, new Date());
    }
  }

  // ---------- send ----------
  const paintSend = () => {
    const missing = draft.missing;
    const b = $("#send");
    b.disabled = !!missing || sending;
    render(b, sending ? html`<span>Sending</span>` : missing ? html`<span>${missing}</span>` : html`${icon("send")}<span>Send to the city</span>`);
    render($("#err"), error ? html`<div class="error-box row top">${icon("error")}<p class="sub">${error}</p></div>` : "");
  };

  const send = async (force) => {
    sending = true;
    error = null;
    paintSend();
    const who = draft.anonymous ? null : contactSaved();
    try {
      if (!force) {
        const dup = await checkDuplicate(draft);
        if (dup.level === "2") { error = dup.message; return; }
        if (dup.level === "1") {
          sending = false;
          paintSend();
          if (await confirmDialog({ title: "Already reported here?", message: dup.message, ok: "Send anyway" })) await send(true);
          return;
        }
      }
      const wo = await submit(draft, who, await robotToken($("#turnstile")));
      sessionStorage.setItem(`done:${ctx.tab}`, JSON.stringify({ wo, note: draft.autoresponse }));
      loadMyReports();
      ctx.go(`/${ctx.tab}/done`, { replace: true });
    } catch (e) {
      if (e.offline) {
        await enqueue(draft, who);
        sessionStorage.setItem(`done:${ctx.tab}`, JSON.stringify({ wo: "", note: draft.autoresponse, queued: true }));
        ctx.go(`/${ctx.tab}/done`, { replace: true });
        return;
      }
      error = e.message;
    } finally {
      sending = false;
      if (main.isConnected) paintSend();
    }
  };
  off(on(main, "submit", "#rf", (e) => { e.preventDefault(); if (!draft.missing && !sending) send(false); }));

  // The robot check gets a fresh token at each send (robot.js); load its script now.
  warmRobotCheck();

  paintPhotos();
  paintLocation();
  paintSend();
  (async () => {
    if (!draft.location) {
      locating = true;
      paintLocation();
      const pt = await current();
      locating = false;
      if (pt && main.isConnected) await draft.setLocation(pt, "phone GPS");
      if (!main.isConnected) return;
      paintLocation();
      if (draft.location) refresh();
      else snack("Location is off. Tap the location card to set the spot on the map.");
    } else if (!draft.place) {
      refresh();
    }
  })();
  return off.run;
}

function inputValue(kind, d) {
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return kind === Kind.date ? date : kind === Kind.time ? time : `${date}T${time}`;
}

function parseLocal(v, kind) {
  if (kind === Kind.time) { const [h, m] = v.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; }
  if (kind === Kind.date) { const [y, mo, da] = v.split("-").map(Number); return new Date(y, mo - 1, da); }
  return new Date(v);
}

/** One of the city's questions, drawn by kind. */
function questionField(q, i, draft) {
  const id = `q-${i}`;
  const star = q.required && q.kind !== Kind.yesNo ? raw(' <span aria-hidden="true">*</span>') : "";
  const req = q.required && q.kind !== Kind.yesNo ? "required aria-required=\"true\"" : "";
  if (q.kind === Kind.yesNo) {
    const yes = draft.answers[q.caption] === "YES";
    return html`<div class="card stack s12" role="group" aria-labelledby="${id}-l">
      <span class="sub strong" id="${id}-l">${q.caption}</span>
      <div class="seg"><button type="button" data-yes="YES" data-qi="${i}" aria-pressed="${String(yes)}">Yes</button>
        <button type="button" data-yes="NO" data-qi="${i}" aria-pressed="${String(!yes)}">No</button></div>
    </div>`;
  }
  if (q.kind === Kind.choice) {
    const picked = new Set(draft.choiceAnswers[q.caption] || []);
    return html`<div class="card stack s12" role="group" aria-labelledby="${id}-l">
      <span class="sub strong" id="${id}-l">${q.caption}${star}${q.multiple ? html`<span class="caption muted"> (pick any)</span>` : ""}</span>
      <div class="row wrap">${q.options.map((o) => html`<button type="button" class="chip-x" data-opt="${o.id}" data-qi="${i}" aria-pressed="${String(picked.has(o.id))}">
        <i aria-hidden="true" ${picked.has(o.id) ? "" : "hidden"}>${picked.has(o.id) ? "check" : ""}</i><span>${o.value}</span></button>`)}</div>
    </div>`;
  }
  if ([Kind.date, Kind.time, Kind.dateTime].includes(q.kind)) {
    const type = q.kind === Kind.date ? "date" : q.kind === Kind.time ? "time" : "datetime-local";
    return html`<div class="card stack s8"><label class="sub strong" for="${id}">${q.caption}${star}</label>
      <input class="input" id="${id}" type="${type}" data-q="${q.caption}" data-qi="${i}" ${raw(req)}></div>`;
  }
  const ph = q.placeholder || (q.kind === Kind.monthYear ? "MM/yyyy" : "Answer");
  return html`<div class="card stack s8"><label class="sub strong" for="${id}">${q.caption}${star}</label>
    <textarea class="input" id="${id}" rows="2" data-q="${q.caption}" data-qi="${i}" placeholder="${ph}" ${raw(req)}>${draft.answers[q.caption] || ""}</textarea></div>`;
}

