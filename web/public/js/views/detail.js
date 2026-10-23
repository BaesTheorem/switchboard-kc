// One of my reports: status, number, type, place, the status track, the
// request-update button, photos, description, and the staff timeline (with
// update requests merged in), and a box to add a note for staff. Ported from
// ReportDetailView.

import { bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { addNote, cachedFullDetail, fullDetail, listen, loadMyReports, reference, S, visibleReports } from "../state.js";
import { acts, confirmDialog, empty, spinner, statusChip, track } from "../ui.js";
import { requestUpdateButton, wireRequestUpdates } from "./parts.js";

export default function view(main, params, ctx) {
  const off = bag();
  const id = params.id;
  let detail = null, error = null;
  // The note box keeps its text when the screen redraws.
  let note = { text: "", sending: false, sent: false, error: "" };
  const report = () => S.myReports.find((r) => r.id === id);

  const paint = () => {
    // A redraw while the note box has focus puts the cursor back where it was.
    const ta = main.querySelector("#note-text");
    const focus = ta && document.activeElement === ta ? [ta.selectionStart, ta.selectionEnd] : null;
    draw();
    const again = focus && main.querySelector("#note-text");
    if (again && !again.disabled) { again.focus(); again.setSelectionRange(...focus); }
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
      ${d.canAddNote && r ? noteCard() : ""}
    </div>`);
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

  off(acts(main, { retry: load, "send-note": sendNote }));
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
