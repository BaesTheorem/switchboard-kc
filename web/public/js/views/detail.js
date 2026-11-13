// One of my reports: status, number, type, place, the status track, the
// request-update button, photos, description, and the staff timeline (with
// update requests merged in), the rating of a closed report, and a box to
// add a note for staff. Ported from ReportDetailView.

import { bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { STARS } from "../models.js";
import { addNote, cachedFullDetail, fullDetail, listen, loadMyReports, rateReport, ratingOf, reference, S, visibleReports } from "../state.js";
import { acts, confirmDialog, empty, snack, spinner, statusChip, track } from "../ui.js";
import { requestUpdateButton, wireRequestUpdates } from "./parts.js";

export default function view(main, params, ctx) {
  const off = bag();
  const id = params.id;
  let detail = null, error = null;
  // The note box keeps its text when the screen redraws.
  let note = { text: "", sending: false, sent: false, error: "" };
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
            <p class="caption muted">${e.when}</p></div></li>`)}</ol>
      </section>` : ""}
      ${r ? rateCard(r) : ""}
      ${d.canAddNote && r ? noteCard() : ""}
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

  const noteCard = () => html`<section class="stack s8" aria-labelledby="note-h"><h2 class="label" id="note-h">Add a note</h2>
    <div class="card stack s12">
      <label class="field-label" for="note-text">Note for staff</label>
      <textarea class="input" id="note-text" maxlength="2000" placeholder="What should staff know?" ${note.sending ? "disabled" : ""}>${note.text}</textarea>
      <div class="row s12">
        <button class="btn tonal" type="button" data-act="send-note" ${note.sending || !note.text.trim() ? "disabled" : ""}>
          ${note.sending ? "" : icon("send")}<span>${note.sending ? "Sending" : "Send note"}</span></button>
        ${note.sent ? html`<span class="row s4 sub strong done-text">${icon("check_circle")}<span>Note sent</span></span>` : ""}
      </div>
      ${note.error ? html`<p class="caption error-text">${note.error}</p>` : ""}
      <p class="caption muted">Staff see the note in this report's history. It cannot be changed or deleted after it is sent.</p>
    </div></section>`;

  const sendNote = async () => {
    const r = report();
    const text = note.text.trim();
    if (!r || !text || note.sending) return;
    const ok = await confirmDialog({ title: "Send this note to the city?", message: `It goes on ${reference(r)} (${r.label}) as a note from you.`, ok: "Send note" });
    if (!ok) return;
    note = { ...note, sending: true, sent: false, error: "" };
    paint();
    try {
      await addNote(r.id, text);
      note = { text: "", sending: false, sent: true, error: "" };
      detail = await fullDetail(r).catch(() => detail);
    } catch (e) {
      note = { ...note, sending: false, error: e.message };
    }
    if (main.isConnected) paint();
  };

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
    note.sent = false;
    const btn = main.querySelector('[data-act="send-note"]');
    if (btn) btn.disabled = !note.text.trim();
  }));
  off(wireRequestUpdates(main, (rid) => visibleReports().find((x) => x.id === rid)));
  off(listen("mine", paint));
  if (!S.myReports.length) loadMyReports();
  load();
  return off.run;
}
