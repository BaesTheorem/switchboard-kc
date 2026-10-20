// KC Streetcar reports, ported from Streetcar.swift. The Streetcar Authority
// is not part of 311. It has two channels:
// - The See Say text line (816-837-4800) reaches a streetcar dispatcher now,
//   with two-way text. For safety, behavior, cleanliness, and damage.
// - Email to info@kcstreetcar.org is the main inbox. For tracker and display
//   problems, service, and feedback.
// The iPhone app attaches the photos in the system composer. A web page
// cannot do that, so it opens Messages or Mail with the text only, and the
// share sheet carries the photos.

import { current, meters } from "../lib/geo.js";
import { bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { facts, summary } from "../place.js";
import { contactSaved, draftFor, S } from "../state.js";
import { acts, snack } from "../ui.js";

export const SEE_SAY_NUMBER = "8168374800";
export const EMAIL = "info@kcstreetcar.org";
export const SEE_SAY_WEB = "https://tellkcstreetcar.com";

// Names as the See Say form writes them. Positions from OpenStreetMap (ODbL),
// the mean of each stop's two platforms. North to south.
export const STOPS = [
  ["Riverfront (Berkley Riverfront)", 39.11715, -94.57212], ["River Market (3rd & Grand)", 39.11043, -94.58133],
  ["River Market West (4th & Delaware)", 39.10880, -94.58438], ["City Market (5th & Walnut)", 39.10851, -94.58189],
  ["North Loop (7th & Main)", 39.10524, -94.58303], ["Library (9th & Main)", 39.10311, -94.58307],
  ["Metro Center (12th & Main)", 39.09994, -94.58321], ["Power & Light (14th & Main)", 39.09684, -94.58334],
  ["Kauffman Center (16th & Main)", 39.09451, -94.58347], ["Crossroads (19th & Main)", 39.09041, -94.58368],
  ["Union Station (Pershing & Main)", 39.08467, -94.58406], ["WWI Museum & Memorial (27th & Main)", 39.07853, -94.58453],
  ["Union Hill (31st & Main)", 39.07107, -94.58531], ["Armour (35th & Main)", 39.06377, -94.58569],
  ["Westport (39th & Main)", 39.05643, -94.58612], ["Southmoreland (43rd & Main)", 39.04937, -94.58655],
  ["Art Museums (45th & Main)", 39.04591, -94.58674], ["Plaza (Cleaver II & Brookside)", 39.04109, -94.58612],
  ["UMKC (51st & Brookside)", 39.03547, -94.58412],
];

const kinds = (dispatch, names) => names.map((name) => ({ name, dispatch }));

// The See Say form's report types, plus the tracker problem that email suits
// best. A `dispatch` kind goes to See Say first, the others go to email first.
export const KINDS = [
  { group: "Safety / Security", kinds: kinds(true, ["Disruptive Behavior", "Loitering / Sleeping", "Intoxication",
    "Solicitation / Panhandling", "Harassment", "Assault / Fighting", "Suspicious Activity", "Other Safety / Security Issue"]) },
  { group: "Maintenance", kinds: kinds(true, ["Cleanliness / Trash", "Broken Glass", "Graffiti", "Vandalism", "Other Maintenance Issue"]) },
  { group: "Service", kinds: kinds(false, ["Arrival sign / tracker wrong", "Service delay or gap", "Accessibility problem", "Comment / Other Issue"]) },
];
const ALL_KINDS = KINDS.flatMap((g) => g.kinds);
export const DEFAULT_KIND = KINDS[1].kinds[0];

/** The car numbers on the line. "NA" is "Not seen". */
export const CARS = Array.from({ length: 14 }, (_, i) => String(801 + i));

/** The stop nearest a point: [name, meters]. */
export function nearestStop(pt) {
  let best = null;
  for (const [name, lat, lng] of STOPS) {
    const d = meters(pt, { lat, lng });
    if (!best || d < best[1]) best = [name, d];
  }
  return best;
}

/** Where it happened, in the words both messages use. */
export function whereText({ onboard, car, stop }) {
  let w = onboard ? `on board streetcar ${car === "NA" ? "(number not seen)" : car}` : `at the ${stop} stop`;
  if (onboard && stop) w += `, near the ${stop} stop`;
  return w;
}

const gpsText = (place) => (place ? `GPS ${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}` : "");

/** The text to See Say. `st` is { kind, details, onboard, car, stop }; `place` is the draft's place facts. */
export function smsBody(st, place) {
  const gps = gpsText(place);
  return `${st.kind.name}: ${st.details.trim()} Location: ${whereText(st)}.${gps ? ` ${gps}.` : ""}`;
}

export const mailSubject = (st) => `[Issue Report] ${st.kind.name} - ${st.onboard ? `Streetcar ${st.car}` : st.stop}`;

const fullDate = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short" });

/** The email to the Authority, signed with the saved contact. */
export function mailBody(st, { place = null, photos = 0, contact = {}, when = new Date() } = {}) {
  const lines = ["Hello,", "", `I want to report a problem I saw on ${fullDate.format(when)}.`, "",
    st.details.trim(), "", `Location: ${whereText(st)}.`];
  if (place) lines.push(`${summary(place)}.`);
  if (photos) lines.push("", "A photo is attached.");
  lines.push("", "Please let me know if you need more details.");
  const sig = [`${contact.firstName || ""} ${contact.lastName || ""}`.trim(), contact.phone || "", contact.email || ""].filter(Boolean);
  if (sig.length) lines.push("", "Thank you,", ...sig);
  return lines.join("\n");
}

/** An iPhone or iPad. iPadOS reports a Mac, so touch tells the two apart. */
export function appleTouch(nav = globalThis.navigator, doc = globalThis.document) {
  const touch = nav?.maxTouchPoints > 0 || (doc != null && "ontouchend" in doc);
  return /iPad|iPhone|iPod|Macintosh/.test(nav?.userAgent || "") && touch;
}

/** An sms: link to See Say with the text filled in. iOS reads "&body=", other systems "?body=". */
export const smsHref = (body, apple) =>
  `sms:${encodeURIComponent(SEE_SAY_NUMBER)}${apple ? "&" : "?"}body=${encodeURIComponent(body)}`;

/** A mailto: link to the Authority. Each part is encoded; the "@" stays, as RFC 6068 writes it. */
export function mailtoHref(subject, body) {
  const [user, host] = EMAIL.split("@");
  return `mailto:${encodeURIComponent(user)}@${encodeURIComponent(host)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const blobUrl = (u) => (/^blob:/.test(String(u)) ? u : "");
const isEmptyDraft = (d) => !d.category && !d.photos.length && !d.location && !d.place && !d.notes.trim();
const photoFiles = (photos) => photos.map((p, i) => new File([p.blob], `photo${i + 1}.jpg`, { type: p.blob.type || "image/jpeg" }));
function canShare(files) {
  try { return files.length > 0 && !!navigator.canShare?.({ files }); } catch { return false; }
}

export default function streetcar(main, params, ctx) {
  ctx.title("Streetcar");
  const draft = draftFor(ctx.tab);
  const st = { kind: DEFAULT_KIND, stop: draft.location ? nearestStop(draft.location)[0] : "", onboard: false, car: "NA", details: "" };
  const add = bag();
  let alive = true;
  let actionsKey = "";
  add(() => { alive = false; });

  render(main, html`
    <div class="screen stack s24 streetcar">
      <div class="row">
        <div class="avatar">${icon("tram")}</div>
        <div class="grow">
          <div class="headline">KC Streetcar</div>
          <div class="sub muted">Not part of 311. This goes to the Streetcar Authority.</div>
        </div>
      </div>
      <div class="stack s8">
        <h2 class="label"><label class="label" for="sc-kind">What happened</label></h2>
        <div class="card">
          <select class="input" id="sc-kind">${KINDS.map((g) => html`
            <optgroup label="${g.group}">${g.kinds.map((k) => html`<option value="${k.name}" ${k === st.kind ? "selected" : ""}>${k.name}</option>`)}</optgroup>`)}
          </select>
        </div>
      </div>
      <div class="stack s8">
        <h2 class="label" id="sc-where">Where</h2>
        <div class="rows" role="group" aria-labelledby="sc-where">
          <div class="sc-pick">
            <label class="sub" for="sc-stop">Stop</label>
            <select class="input" id="sc-stop">
              ${st.stop ? "" : html`<option value="" disabled selected data-finding>Finding the nearest stop</option>`}
              ${STOPS.map(([name]) => html`<option value="${name}" ${name === st.stop ? "selected" : ""}>${name}</option>`)}
            </select>
          </div>
          <label class="toggle-row">
            <span class="grow sub">On board a streetcar</span>
            <span class="switch"><input type="checkbox" role="switch" id="sc-onboard"><span></span></span>
          </label>
          <div class="sc-pick" data-car hidden>
            <label class="sub" for="sc-car">Car number</label>
            <select class="input" id="sc-car">
              <option value="NA" selected>Not seen</option>
              ${CARS.map((n) => html`<option value="${n}">${n}</option>`)}
            </select>
          </div>
        </div>
        <div class="caption muted" data-place hidden></div>
      </div>
      <div class="stack s8">
        <h2 class="label"><label class="label" for="sc-details">Details</label></h2>
        <div class="card">
          <textarea class="input" id="sc-details" rows="3" placeholder="What should staff know?"></textarea>
        </div>
      </div>
      <div class="stack s8" data-photos hidden></div>
      <div class="stack s12 sc-actions" data-actions></div>
      <div data-result role="status" aria-live="polite"></div>
    </div>`);

  const $el = (sel) => main.querySelector(sel);

  function paintPlace() {
    const p = $el("[data-place]");
    p.hidden = !draft.place;
    p.textContent = draft.place ? summary(draft.place) : "";
  }

  function paintPhotos() {
    const box = $el("[data-photos]");
    const n = draft.photos.length;
    box.hidden = n === 0;
    render(box, n === 0 ? "" : html`
      <div class="strip" role="list" aria-label="Photos">
        ${draft.photos.map((p, i) => html`<div class="thumb" role="listitem"><img src="${blobUrl(p.url)}" alt="Photo ${i + 1} of ${n}"></div>`)}
      </div>
      ${canShare(photoFiles(draft.photos)) ? html`<button class="btn tonal" type="button" data-act="share">${icon("share")}<span>${n === 1 ? "Share the photo" : "Share the photos"}</span></button>` : ""}
      <div class="caption muted">${n === 1
        ? "A web page cannot add the photo to a text or email. Attach it by hand."
        : "A web page cannot add the photos to a text or email. Attach them by hand."}</div>`);
  }

  // The button that matches the report type comes first. It waits for details;
  // the other channel is always open, as in the iPhone app.
  function paintActions() {
    const ready = st.details.trim() !== "";
    const key = `${st.kind.dispatch}|${ready}`;
    if (key === actionsKey) return;
    actionsKey = key;
    const [first, second] = st.kind.dispatch
      ? [{ act: "sms", title: "Text dispatch (See Say)", icon: "sms" }, { act: "mail", title: "Email the Authority instead", icon: "mail" }]
      : [{ act: "mail", title: "Email the Authority", icon: "mail" }, { act: "sms", title: "Text dispatch instead", icon: "sms" }];
    render($el("[data-actions]"), html`
      <button class="btn" type="button" data-act="${first.act}" ${ready ? "" : "disabled"}>${ready ? icon(first.icon) : ""}<span>${ready ? first.title : "Add details"}</span></button>
      <button class="btn tonal" type="button" data-act="${second.act}">${icon(second.icon)}<span>${second.title}</span></button>
      <a class="link" href="${safeUrl(SEE_SAY_WEB)}" target="_blank" rel="noopener noreferrer">Use the See Say web form<span class="visually-hidden"> (opens a new tab)</span></a>
      <div class="caption muted">${st.kind.dispatch
        ? "See Say reaches a streetcar dispatcher, who can text you back. For an emergency, call 911."
        : "info@kcstreetcar.org is the Authority's main inbox. Replies come to your email."}</div>`);
  }

  function showResult(text) {
    render($el("[data-result]"), html`<div class="card row">${icon("check_circle", "done-text")}<div class="sub grow">${text}</div></div>`);
  }

  function setStop(name) {
    st.stop = name;
    const s = $el("#sc-stop");
    s.querySelector("[data-finding]")?.remove();
    s.value = name;
  }

  // The web cannot know if the message went out, so the card says what opened.
  function openSms() {
    location.href = smsHref(smsBody(st, draft.place), appleTouch());
    showResult("Opened Messages with your text to See Say. Dispatch can reply to your number.");
  }

  function openMail() {
    const body = mailBody(st, { place: draft.place, photos: draft.photos.length, contact: contactSaved() });
    location.href = mailtoHref(mailSubject(st), body);
    showResult(`Opened Mail with your email to ${EMAIL}.`);
  }

  function sharePhotos() {
    const files = photoFiles(draft.photos);
    if (!canShare(files)) { snack("This browser cannot share photos."); return; }
    const text = st.kind.dispatch
      ? smsBody(st, draft.place)
      : mailBody(st, { place: draft.place, photos: files.length, contact: contactSaved() });
    navigator.share({ files, text }).catch((e) => {
      if (alive && e?.name !== "AbortError") snack("The photo was not shared.");
    });
  }

  // As the Swift .task: the phone's position when the draft has none, then the
  // nearest stop, then the place facts for the summary line.
  async function locate() {
    if (isEmptyDraft(draft)) {
      // A reload empties the drafts in memory. Load the saved copy first, so
      // that setLocation() does not write over it.
      const restored = await draft.restore(S.categories).catch(() => false);
      if (!alive) return;
      if (restored) { paintPhotos(); paintPlace(); }
    }
    if (!draft.location) {
      const pt = await current();
      if (!alive) return;
      if (pt && !draft.location) {
        if (!st.stop) setStop(nearestStop(pt)[0]);
        await draft.setLocation(pt, "phone GPS");
        if (!alive) return;
      }
    }
    const loc = draft.location;
    if (loc) {
      if (!st.stop) setStop(nearestStop(loc)[0]);
      if (!draft.place) {
        const f = await facts(loc, draft.locationSource);
        if (draft.location === loc && !draft.place) {
          draft.place = f;
          draft.save();
        }
        if (!alive) return;
        paintPlace();
      }
    }
    if (!st.stop) setStop(STOPS[0][0]);
  }

  paintPhotos();
  paintPlace();
  paintActions();
  add(
    on(main, "change", "#sc-kind", (e, t) => {
      st.kind = ALL_KINDS.find((k) => k.name === t.value) || DEFAULT_KIND;
      paintActions();
    }),
    on(main, "change", "#sc-stop", (e, t) => {
      t.querySelector("[data-finding]")?.remove();
      st.stop = t.value;
    }),
    on(main, "change", "#sc-onboard", (e, t) => {
      st.onboard = t.checked;
      $el("[data-car]").hidden = !t.checked;
    }),
    on(main, "change", "#sc-car", (e, t) => { st.car = t.value; }),
    on(main, "input", "#sc-details", (e, t) => {
      st.details = t.value;
      paintActions();
    }),
    acts(main, { sms: openSms, mail: openMail, share: sharePhotos }),
  );
  locate().catch((e) => console.error(e));
  return add.run;
}
