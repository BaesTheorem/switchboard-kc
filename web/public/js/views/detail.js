// One of my reports: status, number, type, place, the status track, the
// request-update button, photos, description, and the staff timeline (with
// update requests merged in), the rating of a closed report, and a box to
// add a note and photos for staff, on the report or on one of its update
// requests. Ported from ReportDetailView.

import { bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { STARS } from "../models.js";
import { preparePhoto } from "../lib/image.js";
import { shortDate } from "../lib/format.js";
import { addNote, cachedDetail, cachedFullDetail, fullDetail, listen, loadMyReports, rateReport, ratingOf, reference, S, updateRequestsFor, visibleReports } from "../state.js";
import { acts, confirmDialog, empty, snack, spinner, statusChip, track } from "../ui.js";
import { photoInputs, requestUpdateButton, wirePhotoInputs, wireRequestUpdates } from "./parts.js";

const MAX_PHOTOS = 4;

export default function view(main, params, ctx) {
  const off = bag();
  const id = params.id;
  let detail = null, error = null;
  // The note box keeps its text, photos and target when the screen redraws.
  // `to` is the id of the report or update request the note goes on.
  let note = { text: "", photos: [], to: id, sending: false, sent: "", error: "" };
  // The rating card keeps its stars and its comment in the same way.
  let rate = { value: 0, text: "", sending: false, error: "" };
  const report = () => S.myReports.find((r) => r.id === id);

  const paint = () => {
    // A redraw while a text box or a star has focus puts the focus (and the cursor) back where it was.
    const a = document.activeElement;
    const keep = a && a.id && main.contains(a) ? { id: a.id, sel: a.tagName === "TEXTAREA" ? [a.selectionStart, a.selectionEnd] : null } : null;
    draw();
    const again = keep && main.querySelector(`#${CSS.escape(keep.id)}`);
    if (again && !again.disabled) { again.focus(); if (keep.sel) again.setSelectionRange(...keep.sel); }
  };

  const draw = () => {
    const r = report();
    ctx.title(r ? (r.caseNumber ? `#${r.caseNumber}` : `Report ${r.id}`) : `Report ${id}`);
    if (!detail) {
      render(main, html`<div class="screen">${error
        ? empty({ icon: "cloud_off", title: "Cannot load this report", message: error, action: { label: "Try again", attr: 'data-act="retry"' } })
        : spinner()}</div>`);
      return;
    }
    const d = detail;
    const notable = targets();
    render(main, html`<div class="screen stack s20">
      <section class="card stack s12">
        <div class="row">${statusChip(d.status)}<span class="grow"></span>
          ${d.caseNumber ? html`<span class="mono muted" style="user-select:text">#${d.caseNumber}</span>` : ""}</div>
        <h2 class="title2">${d.subtype || d.type}</h2>
        ${d.address ? html`<div class="row s8 sub">${icon("location_on")}<span>${d.address}</span></div>` : ""}
        ${track(d.status, d.timeline)}
        ${r?.isOpen ? requestUpdateButton(r) : ""}
      </section>
      ${d.photos.length ? html`<div class="strip">${d.photos.map((u, i) => html`<a class="thumb big" href="${safeUrl(u)}" target="_blank" rel="noopener">
        <img src="${u}" alt="Photo ${i + 1} of the report" loading="lazy"></a>`)}</div>` : ""}
      ${d.description ? html`<p class="card sub prewrap">${d.description}</p>` : ""}
      ${d.timeline.length ? html`<section class="stack s8" aria-labelledby="tl-h"><h2 class="label" id="tl-h">Timeline</h2>
        <ol class="card timeline" style="list-style:none;margin:0">${[...d.timeline].reverse().map((e) => html`<li class="entry">
          <span class="rail" aria-hidden="true"><b></b><s></s></span>
          <div class="body stack s4"><p class="sub strong">${e.title}</p>
            ${e.details ? html`<p class="sub muted prewrap">${e.details}</p>` : ""}
            ${e.photos?.length ? html`<div class="strip">${e.photos.map((u, i) => html`<a class="thumb" href="${safeUrl(u)}" target="_blank" rel="noopener">
              <img src="${u}" alt="Photo ${i + 1} with this entry" loading="lazy"></a>`)}</div>` : ""}
            <p class="caption muted">${e.when}</p>
            ${e.title === "Update requested" && notable.some((t) => t.id === e.request) ? html`<div><button class="btn text small" type="button" data-note-to="${e.request}">
              ${icon("forum")}<span>Add a note to this request</span></button></div>` : ""}</div></li>`)}</ol>
      </section>` : ""}
      ${r ? rateCard(r) : ""}
      ${notable.length ? noteCard(notable) : ""}
    </div>`);
  };

  const starWord = (n) => (n === 1 ? "1 star" : `${n} stars`);

  // A closed report with no rating gets five stars and an optional comment.
  // A report with a rating shows it. Five radio buttons carry the stars, so
  // the arrow keys and a screen reader work with no code of their own.
  const rateCard = (r) => {
    const have = ratingOf(r);
    if (have) {
      return html`<section class="stack s8" aria-labelledby="rate-h"><h2 class="label" id="rate-h">Your rating</h2>
        <div class="card stack s8">
          <span class="stars shown" role="img" aria-label="${have} of 5 stars">${STARS.map((n) => icon("star", n <= have ? "fill on" : ""))}</span>
          <p class="sub muted">You gave the city's work ${have} of 5 stars. The city has the rating with this report.</p>
        </div></section>`;
    }
    if (!r.canRate) return "";
    return html`<section class="stack s8" aria-labelledby="rate-h"><h2 class="label" id="rate-h">Rate the city's work</h2>
      <div class="card stack s12">
        <div class="stars" role="radiogroup" aria-labelledby="rate-h">
          ${STARS.map((n) => html`<input class="visually-hidden" type="radio" name="stars" id="star-${n}" value="${n}" ${rate.value === n ? "checked" : ""} ${rate.sending ? "disabled" : ""}>
          <label class="star ${n <= rate.value ? "on" : ""}" for="star-${n}">${icon("star", n <= rate.value ? "fill" : "")}<span class="visually-hidden">${starWord(n)}</span></label>`)}
        </div>
        <label class="field-label" for="rate-text">Comment for the city (optional)</label>
        <textarea class="input" id="rate-text" maxlength="2000" placeholder="What went well? What did not?" ${rate.sending ? "disabled" : ""}>${rate.text}</textarea>
        <div class="row s12">
          <button class="btn tonal" type="button" data-act="send-rating" ${rate.sending || !rate.value ? "disabled" : ""}>
            ${rate.sending ? "" : icon("send")}<span>${rate.sending ? "Sending" : "Send rating"}</span></button>
        </div>
        ${rate.error ? html`<p class="caption error-text" role="alert">${rate.error}</p>` : ""}
        <p class="caption muted">The rating goes to the city's 311 system with this report. It cannot be changed after it is sent.</p>
      </div></section>`;
  };

  const sendRating = async () => {
    const r = report();
    if (!r || !rate.value || rate.sending) return;
    const stars = rate.value;
    const ok = await confirmDialog({ title: `Send ${starWord(stars)} to the city?`, message: `The rating goes on ${reference(r)} (${r.label}). It cannot be changed after it is sent.`, ok: "Send rating" });
    if (!ok) return;
    rate = { ...rate, sending: true, error: "" };
    paint();
    try {
      const o = await rateReport(r.id, stars, rate.text.trim());
      rate = { value: 0, text: "", sending: false, error: "" };
      snack(o.dry ? "Dry run: the rating did not go to the city." : "The city has your rating. Thank you.");
    } catch (e) {
      rate = { ...rate, sending: false, error: e.message };
    }
    if (main.isConnected) paint();
  };

  /** Where a note can go: this report and each of its update requests that the city opens to notes. */
  const targets = () => {
    const r = report();
    if (!r || !detail) return [];
    const out = [];
    if (detail.canAddNote) out.push({ id: r.id, label: `This report (${r.caseNumber ? `#${r.caseNumber}` : r.id})`, ref: reference(r), name: r.label });
    for (const q of updateRequestsFor(r)) {
      if (!cachedDetail(q.id)?.canAddNote) continue;
      const when = q.added ? `, ${shortDate(q.added)}` : "";
      out.push({ id: q.id, label: `Update request ${q.id}${when}`, ref: `update request ${q.id}`, name: q.label });
    }
    return out;
  };
  const targetOf = (list) => list.find((t) => t.id === note.to) || list[0];

  const noteCard = (list) => {
    const to = targetOf(list);
    const n = note.photos.length;
    const empty = !note.text.trim() && !n;
    return html`<section class="stack s8" aria-labelledby="note-h"><h2 class="label" id="note-h">Add a note</h2>
    <div class="card stack s12">
      ${list.length > 1 ? html`<label class="field-label" for="note-to">Add the note to</label>
        <select class="input" id="note-to" ${note.sending ? "disabled" : ""}>
          ${list.map((t) => html`<option value="${t.id}" ${t.id === to.id ? "selected" : ""}>${t.label}</option>`)}
        </select>` : ""}
      <label class="field-label" for="note-text">Note for staff</label>
      <textarea class="input" id="note-text" maxlength="2000" placeholder="What should staff know?" ${note.sending ? "disabled" : ""}>${note.text}</textarea>
      <div class="strip">
        ${note.photos.map((p, i) => html`<div class="thumb"><img src="${p.url}" alt="Photo ${i + 1} of ${n} for the note">
          ${note.sending ? "" : html`<button class="remove" type="button" data-note-rm="${i}" aria-label="Remove photo ${i + 1}">${icon("close")}</button>`}</div>`)}
        ${n < MAX_PHOTOS && !note.sending ? html`
          <button class="thumb add" type="button" data-note-add="camera" aria-label="Take a photo for the note">${icon("add_a_photo")}</button>
          <button class="thumb add" type="button" data-note-add="library" aria-label="Add a photo from the library to the note">${icon("photo_library")}</button>` : ""}
      </div>
      <div class="row s12">
        <button class="btn tonal" type="button" data-act="send-note" ${note.sending || empty ? "disabled" : ""}>
          ${note.sending ? "" : icon("send")}<span>${note.sending ? "Sending" : "Send note"}</span></button>
        ${note.sent ? html`<span class="row s4 sub strong done-text">${icon("check_circle")}<span>${note.sent}</span></span>` : ""}
      </div>
      ${note.error ? html`<p class="caption error-text" role="alert">${note.error}</p>` : ""}
      <p class="caption muted">Staff see the note and the photos in the history of ${to.ref}. You can add up to ${MAX_PHOTOS} photos. A note cannot be changed or deleted after it is sent.</p>
    </div></section>`;
  };

  const sendNote = async () => {
    const to = targetOf(targets());
    const text = note.text.trim();
    const photos = note.photos.map((p) => p.blob);
    if (!to || (!text && !photos.length) || note.sending) return;
    const what = text && photos.length ? "this note and the photos" : text ? "this note" : photos.length === 1 ? "this photo" : "these photos";
    const ok = await confirmDialog({ title: `Send ${what} to the city?`, message: `It goes on ${to.ref} (${to.name}) from you.`, ok: "Send note" });
    if (!ok) return;
    note = { ...note, to: to.id, sending: true, sent: "", error: "" };
    paint();
    try {
      const o = await addNote(to.id, text, photos);
      clearPhotos();
      note = { ...note, text: "", photos: [], sending: false, sent: o.dry ? "Dry run: not sent" : to.id === id ? "Note sent" : `Note sent to update request ${to.id}` };
      const r = report();
      if (r) detail = await fullDetail(r).catch(() => detail);
    } catch (e) {
      // The text went to the city when only the photos failed: keep the photos, clear the text.
      note = { ...note, text: e.code === "photos_refused" ? "" : note.text, sending: false, error: e.message };
    }
    if (main.isConnected) paint();
  };

  const clearPhotos = () => { for (const p of note.photos) URL.revokeObjectURL(p.url); };

  // The file inputs live outside the screen, so a redraw while the picker is open does not lose the photo.
  const pickerBox = document.createElement("div");
  render(pickerBox, photoInputs("note"));
  document.body.append(pickerBox);
  const pickers = wirePhotoInputs(pickerBox, "note", async (file) => {
    if (note.photos.length >= MAX_PHOTOS) return;
    const { blob } = await preparePhoto(file, 800);
    note.photos = [...note.photos, { blob, url: URL.createObjectURL(blob) }];
    note.sent = "";
    note.error = "";
    if (main.isConnected) paint();
  });
  off(pickers.off);
  off(() => { pickerBox.remove(); clearPhotos(); });

  const load = async () => {
    const r = report() || { id, caseNumber: "" };
    if (!detail) detail = cachedFullDetail(r);
    paint();
    try {
      detail = await fullDetail(r);
      error = null;
    } catch (e) {
      if (!detail) error = e.message;
    }
    if (main.isConnected) paint();
  };

  off(acts(main, { retry: load, "send-note": sendNote, "send-rating": sendRating }));
  off(on(main, "change", 'input[name="stars"]', (_e, el) => { rate.value = Number(el.value); rate.error = ""; paint(); }));
  off(on(main, "input", "#rate-text", (_e, el) => { rate.text = el.value; }));
  off(on(main, "input", "#note-text", (e, el) => {
    note.text = el.value;
    note.sent = "";
    const btn = main.querySelector('[data-act="send-note"]');
    if (btn) btn.disabled = !note.text.trim() && !note.photos.length;
  }));
  off(on(main, "change", "#note-to", (_e, el) => { note.to = el.value; note.sent = ""; note.error = ""; paint(); }));
  off(on(main, "click", "[data-note-add]", (_e, b) => (b.dataset.noteAdd === "camera" ? pickers.camera() : pickers.library())));
  off(on(main, "click", "[data-note-rm]", (_e, b) => {
    const [p] = note.photos.splice(Number(b.dataset.noteRm), 1);
    if (p) URL.revokeObjectURL(p.url);
    paint();
  }));
  off(on(main, "click", "[data-note-to]", (_e, b) => {
    note.to = b.dataset.noteTo;
    note.sent = "";
    note.error = "";
    paint();
    const box = main.querySelector("#note-text");
    box?.scrollIntoView({ block: "center", behavior: "smooth" });
    box?.focus({ preventScroll: true });
  }));
  off(wireRequestUpdates(main, (rid) => visibleReports().find((x) => x.id === rid)));
  off(listen("mine", paint));
  if (!S.myReports.length) loadMyReports();
  load();
  return off.run;
}
