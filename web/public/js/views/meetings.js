// City meetings: every public meeting of the City Council, its committees and
// the city's boards, from Common Lot's copy of the city's Legistar calendar
// plus the EDC boards (worker/open.js relays it). Two views: what is coming
// up, by day, and the boards by subject. A meeting opens a sheet with the
// agenda, the public comment rule and add-to-calendar links. Calendar
// subscriptions use this server's /cal/ feeds. The last list is saved, so the
// screen opens with no connection. Web only: the iPhone app has no meetings.

import { authHeaders } from "../api.js";
import { bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { idb } from "../lib/store.js";
import { acts, label, sheet, snack } from "../ui.js";
import { matches } from "./city.js";
import { loadingRow, reason, refreshButton } from "./places.js";

const TZ = "America/Chicago";
const fDay = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
const fShort = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const fTime = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

const CLUSTERS = [["council", "City Council"], ["council-committees", "Council committees"], ["land-use", "Land use and zoning"],
  ["housing", "Housing"], ["transportation", "Transportation"], ["finance-and-development", "Finance and economic development"],
  ["public-safety", "Public safety"], ["health-and-human-services", "Health and human services"], ["rights-and-ethics", "Rights and ethics"],
  ["parks-arts-culture", "Parks, arts and culture"], ["elections", "Elections"], ["pensions-and-administration", "Pensions and city administration"],
  ["community-improvement-districts", "Community improvement districts"], ["other", "Other boards"]];
const COMMITTEES = new Set(["Finance, Governance and Public Safety Committee", "Neighborhood Planning and Development Committee",
  "Transportation, Infrastructure and Operations Committee"]);

// Kept while the app runs, so a meeting sheet and the way back keep the place.
let view = "upcoming";
let query = "";

/** The public comment rule we know of for a body (the same rules as Common Lot's meetings page). */
export function commentRule(m, info) {
  if (m.body === "Council" || m.body === "Business Session")
    return "The full council usually takes no public testimony. Testimony on an ordinance goes to the committee that hears it.";
  if (info?.cluster === "council-committees" || COMMITTEES.has(m.body))
    return "Council committees take 2 minutes of testimony from each person. Written testimony goes to public.testimony@kcmo.org, and the clerk adds it to the public record.";
  if (m.body === "City Plan Commission")
    return "2 minutes for each person, or 5 for an organization. State your name and address first. On Zoom, use \"raise hand\" when the planner presents the case. Written testimony goes to publicengagement@kcmo.org at least 24 hours before the hearing.";
  return "Check the agenda for public comment rules.";
}

/** A Google Calendar link that adds one meeting. */
export function googleLink(m) {
  const z = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const details = [m.zoom && `Join online: ${m.zoom}`, m.agenda && `Agenda: ${m.agenda}`, m.detail && `Meeting page: ${m.detail}`,
    "End time is an estimate: the city lists start times only."].filter(Boolean).join("\n");
  return "https://calendar.google.com/calendar/render?" + new URLSearchParams({
    action: "TEMPLATE", text: (m.cancelled ? "CANCELLED: " : "") + m.body, dates: `${z(m.start)}/${z(m.end)}`, details, location: m.location || "",
  });
}

async function load(fresh) {
  const get = async (what) => {
    const r = await fetch(`/api/${what}`, { headers: authHeaders(), cache: fresh ? "no-store" : "default" });
    const o = await r.json().catch(() => null);
    if (!r.ok) throw new Error(o?.message || `The server returned an error (HTTP ${r.status}).`);
    return o;
  };
  const [data, bodies] = await Promise.all([get("meetings"), get("bodies").catch(() => [])]);
  const saved = { at: Date.now(), data, bodies: Array.isArray(bodies) ? bodies : [] };
  await idb.set("meetings", saved);
  return saved;
}

export default function meetingsView(main) {
  let state = null;   // { at, data: { fetched, error, meetings }, bodies }
  let error = null;
  let busy = false;
  let dead = false;

  const all = () => state?.data?.meetings || [];
  const bodies = () => state?.bodies || [];
  const infoFor = (m) => bodies().find((b) => (b.legistar_body_id && b.legistar_body_id === m.bodyId) || b.name === m.body) || null;
  const hit = (m) => matches(query, `${m.body} ${infoFor(m)?.short || ""}`);
  const time = (m) => (m.timeKnown === false ? "Time not posted" : fTime.format(new Date(m.start)));

  const row = (m) => html`<button class="item" type="button" data-act="open" data-id="${m.id}">
    <span class="mono sub" style="min-width:68px">${m.timeKnown === false ? "TBA" : fTime.format(new Date(m.start))}</span>
    <span class="grow stack s4" style="gap:2px">
      <span class="${m.cancelled ? "muted" : ""}" style="${m.cancelled ? "text-decoration:line-through" : ""}">${m.body}</span>
      <span class="caption muted clamp2">${[m.cancelled ? "Cancelled" : "", m.location || "", m.zoom ? "Zoom" : ""].filter(Boolean).join(" · ")}</span>
    </span>${icon("chevron_right", "trail")}</button>`;

  const upcoming = () => {
    const now = Date.now();
    const list = all().filter((m) => new Date(m.end).getTime() >= now && hit(m));
    if (!list.length) return html`<div class="rows"><p class="cell muted">${query ? "No upcoming meeting matches that name." : "No meetings are posted yet."}</p></div>`;
    const days = new Map();
    for (const m of list) {
      const k = dayKey(new Date(m.start));
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(m);
    }
    return [...days.values()].map((ms) => html`<section class="stack s8">
      ${label(fDay.format(new Date(ms[0].start)))}
      <div class="rows">${ms.map(row)}</div></section>`);
  };

  const boards = () => {
    const now = Date.now();
    const next = new Map();
    for (const m of all()) if (new Date(m.start).getTime() >= now && !m.cancelled) { const k = m.bodyId || m.body; if (!next.has(k)) next.set(k, m); }
    // Every body in the meeting data gets a row, with a description when Common Lot has one.
    const guess = (m) => (/Primary Legislative/.test(m.bodyType || "") ? "council" : COMMITTEES.has(m.body) ? "council-committees"
      : /Community Improvement/.test(m.bodyType || "") ? "community-improvement-districts" : "other");
    const merged = [...bodies()];
    for (const m of all()) if (!infoFor(m) && !merged.some((b) => b.name === m.body))
      merged.push({ legistar_body_id: m.bodyId, name: m.body, short: m.body, cluster: guess(m), description: null });
    const seen = new Set();
    const rows = merged.filter((b) => { const k = b.short || b.name; if (seen.has(k)) return false; seen.add(k); return true; })
      .filter((b) => matches(query, `${b.name} ${b.short || ""} ${b.description || ""}`));
    const out = CLUSTERS.map(([id, title]) => {
      const mine = rows.filter((b) => (b.cluster || "other") === id);
      if (!mine.length) return "";
      return html`<section class="stack s8">${label(title)}<div class="rows">${mine.map((b) => {
        const n = next.get(b.legistar_body_id) || next.get(b.name);
        return html`<div class="cell stack s8" style="align-items:stretch">
          <span class="sub strong">${b.short || b.name}</span>
          <span class="caption muted">${b.description || "The city publishes no description of this body."}</span>
          <span class="row wrap">
            ${n ? html`<button class="btn text" type="button" data-act="open" data-id="${n.id}">${icon("event")}<span>Next: ${fShort.format(new Date(n.start))}</span></button>`
              : html`<span class="caption muted grow">No meeting posted</span>`}
            ${b.legistar_body_id ? html`<button class="btn text" type="button" data-act="subscribe" data-path="/cal/body/${b.legistar_body_id}.ics" data-name="${b.short || b.name}">${icon("calendar_add_on")}<span>Subscribe</span></button>` : ""}
          </span></div>`;
      })}</div></section>`;
    }).filter(Boolean);
    return out.length ? out : html`<div class="rows"><p class="cell muted">No board matches that name.</p></div>`;
  };

  const status = () => {
    const f = state?.data?.fetched?.legistar;
    const count = all().filter((m) => new Date(m.start).getTime() >= Date.now()).length;
    return [`${count} meetings coming up.`, f ? `City calendar read ${fShort.format(new Date(f))} at ${fTime.format(new Date(f))}.` : "",
      state?.data?.error ? "The city calendar did not answer; this is the last copy." : ""].filter(Boolean).join(" ");
  };

  const body = () => html`<div class="screen stack s20">
    <form role="search" data-search>
      <label class="field-label" for="mt-q">Search meetings and boards</label>
      <div class="search-box">${icon("search")}
        <input class="input" id="mt-q" type="search" placeholder="Council, zoning, Land Bank" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search" value="${query}">
      </div>
    </form>
    <div class="seg" role="group" aria-label="Show">
      ${[["upcoming", "Coming up"], ["boards", "Boards"]].map(([k, l]) => html`<button type="button" data-act="view" data-view="${k}" aria-pressed="${String(view === k)}">${l}</button>`)}
    </div>
    <div class="rows"><button class="item" type="button" data-act="subscribe" data-path="/cal/all.ics" data-name="Kansas City public meetings">
      ${icon("calendar_add_on")}<span class="grow stack s4" style="gap:2px"><span>Subscribe to every meeting</span>
      <span class="caption muted">Your calendar app keeps it up to date.</span></span>${icon("chevron_right", "trail")}</button></div>
    ${error && !state ? html`<div class="rows"><p class="cell error-text" role="alert">${error} The city's own calendar is at <a class="primary-text" href="https://kansascity.legistar.com/Calendar.aspx" target="_blank" rel="noopener">kansascity.legistar.com</a>.</p></div>` : ""}
    ${!state && !error ? html`<div class="rows">${loadingRow("Loading meetings")}</div>` : ""}
    ${state ? (view === "boards" ? boards() : upcoming()) : ""}
    ${state ? html`<p class="foot muted" role="status">${status()}${error ? ` Could not refresh: ${error}` : ""} End times are estimates. Meeting data from <a class="primary-text" href="https://github.com/BaesTheorem/common-lot" target="_blank" rel="noopener">Common Lot</a>.</p>` : ""}
    ${refreshButton()}
  </div>`;

  const paint = () => { if (!dead) render(main, body()); };

  function subscribe(path, name) {
    const feed = `${location.origin}${path}`;
    const webcal = feed.replace(/^https?:/, "webcal:");
    sheet({
      title: "Subscribe",
      body: html`<div class="stack s12"><p class="sub">${name}</p>
        <div class="rows">
          <a class="item" href="${safeUrl(webcal)}">${icon("event")}<span class="grow">Apple Calendar or the Outlook app</span></a>
          <a class="item" href="${safeUrl("https://calendar.google.com/calendar/r?" + new URLSearchParams({ cid: webcal }))}" target="_blank" rel="noopener">${icon("open_in_new")}<span class="grow">Google Calendar</span></a>
          <a class="item" href="${safeUrl("https://outlook.live.com/calendar/0/addfromweb?" + new URLSearchParams({ url: feed, name }))}" target="_blank" rel="noopener">${icon("open_in_new")}<span class="grow">Outlook.com</span></a>
          <button class="item" type="button" data-copy>${icon("content_copy")}<span class="grow">Copy the feed address</span></button>
        </div>
        <p class="caption muted">A subscription updates by itself when the city adds, moves or cancels a meeting.</p></div>`,
      mount: (el) => on(el, "click", "[data-copy]", async () => { await navigator.clipboard?.writeText(feed); snack("Copied the feed address."); }),
    });
  }

  function openMeeting(m) {
    const info = infoFor(m);
    const papers = [m.agenda && ["Agenda", m.agenda], m.minutes && ["Minutes", m.minutes], m.video && ["Video", m.video], m.detail && ["Meeting page", m.detail]].filter(Boolean);
    sheet({
      title: "Meeting",
      body: html`<div class="stack s16">
        <div class="stack s4"><p class="caption muted">${fDay.format(new Date(m.start))} · ${time(m)}</p>
          <h3 class="title2">${m.body}</h3>${m.cancelled ? html`<p class="sub error-text strong">Cancelled</p>` : ""}</div>
        ${info?.description ? html`<p class="sub">${info.description}${info.source ? html` <a class="primary-text" href="${safeUrl(info.source)}" target="_blank" rel="noopener">Source</a>` : ""}</p>` : ""}
        <div class="rows">
          ${m.location ? html`<div class="cell">${icon("location_on")}<span class="grow sub">${m.location}</span></div>` : ""}
          ${m.zoom ? html`<a class="item" href="${safeUrl(m.zoom)}" target="_blank" rel="noopener">${icon("videocam")}<span class="grow">Join on Zoom</span>${icon("open_in_new", "trail")}</a>` : ""}
          ${papers.length ? papers.map(([l, u]) => html`<a class="item" href="${safeUrl(u)}" target="_blank" rel="noopener">${icon("description")}<span class="grow">${l}</span>${icon("open_in_new", "trail")}</a>`)
            : html`<div class="cell">${icon("description")}<span class="grow sub muted">Agenda not posted yet</span></div>`}
        </div>
        <section class="stack s8">${label("Public comment")}<p class="sub">${commentRule(m, info)} Rules can change: confirm them on the agenda.</p></section>
        <section class="stack s8">${label("Add to calendar")}
          <div class="rows">
            <a class="item" href="${safeUrl(googleLink(m))}" target="_blank" rel="noopener">${icon("open_in_new")}<span class="grow">Google Calendar</span></a>
            <a class="item" href="/cal/meeting/${encodeURIComponent(m.id)}.ics">${icon("event")}<span class="grow">Apple Calendar or other (.ics file)</span></a>
            ${m.bodyId ? html`<button class="item" type="button" data-sub>${icon("calendar_add_on")}<span class="grow">Subscribe to every ${m.body} meeting</span></button>` : ""}
          </div></section>
        <p class="caption muted">Source: ${m.source}. End times are estimates: the city lists start times only.</p>
      </div>`,
      mount: (el) => on(el, "click", "[data-sub]", () => subscribe(`/cal/body/${m.bodyId}.ics`, m.body)),
    });
  }

  async function refresh(fresh) {
    if (busy) return;
    busy = true;
    try {
      state = await load(fresh);
      error = null;
    } catch (e) {
      error = reason(e);
    } finally {
      busy = false;
      paint();
    }
  }

  const add = bag();
  add(
    acts(main, {
      view: (b) => { view = b.dataset.view; paint(); },
      open: (b) => { const m = all().find((x) => x.id === b.dataset.id); if (m) openMeeting(m); },
      subscribe: (b) => subscribe(b.dataset.path, b.dataset.name),
      refresh: () => refresh(true),
    }),
    on(main, "input", "#mt-q", (_e, el) => {
      query = el.value;
      const at = el.selectionStart;
      paint();
      const again = main.querySelector("#mt-q");
      again.focus();
      again.setSelectionRange(at, at);
    }),
    on(main, "submit", "[data-search]", (e) => { e.preventDefault(); main.querySelector("#mt-q")?.blur(); }),
  );

  paint();
  idb.get("meetings").then((saved) => {
    if (dead) return;
    if (saved?.data && !state) { state = saved; paint(); }
    refresh(false);
  });
  return () => { dead = true; add.run(); };
}
