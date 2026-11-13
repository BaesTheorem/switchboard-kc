// Everything the screens read: the report catalog, my reports, report
// details, map pins, the offline queue, and update requests. Each is saved
// on the device and shown at once on launch; the network refresh replaces it
// in the background. Ported from Store.swift and AutoUpdates.swift.

import { api } from "./api.js";
import { reportCategories, updateCategory } from "./catalog.js";
import { Draft, KANSAS_CITY } from "./draft.js";
import { dateTime, relative, shortDate } from "./lib/format.js";
import { meters } from "./lib/geo.js";
import { idb, local } from "./lib/store.js";
import { zipStore } from "./lib/zip.js";
import { dueForUpdate, Kind, lastAskedAt, mapIssue, myReport, readCatalog, reference, reportDetail, requestsNaming, subId, UPDATE_TEXT, WEEK } from "./models.js";

export const S = {
  config: null,
  categories: [],
  links: [],
  catalogError: null,
  myReports: [],
  myState: "idle",           // idle | loading | loaded | failed
  myError: null,
  queued: [],                // [{ id, title, issueJSON, zip, created, error? }]
  map: { open: [], closed: [], all: [] },
  mapLoading: new Set(),
  mapError: null,
  mapCenter: local.get("mapCenter"),
  details: {},               // id → { at, issue }
  notices: local.get("notices", []),   // the city's notices: [{ id, title, text, links, at }]
};

// ---------- events ----------

const subs = new Map();
export function listen(evt, fn) {
  if (!subs.has(evt)) subs.set(evt, new Set());
  subs.get(evt).add(fn);
  return () => subs.get(evt)?.delete(fn);
}
export function emit(evt) {
  for (const fn of subs.get(evt) || []) { try { fn(); } catch (e) { console.error(e); } }
}

// ---------- the reports id ----------

const ID_RE = /^[0-9a-f]{16}$/;
const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The id the city files "my reports" under. KCMO has no accounts, so losing
 * this id loses the list. It is kept in localStorage and IndexedDB; Settings
 * shows it, copies it, and restores a saved one.
 */
export function deviceId() {
  let id = local.get("deviceUID");
  if (!ID_RE.test(id || "")) {
    id = newId();
    local.set("deviceUID", id);
    idb.set("deviceUID", id);
  }
  return id;
}

/** At launch: a copy in one store repairs the other. */
export async function recoverDeviceId() {
  const l = local.get("deviceUID");
  const i = await idb.get("deviceUID");
  if (!ID_RE.test(l || "") && ID_RE.test(i || "")) local.set("deviceUID", i);
  else if (ID_RE.test(l || "") && l !== i) await idb.set("deviceUID", l);
  deviceId();
}

export function useDeviceId(raw) {
  const id = String(raw || "").trim().toLowerCase();
  if (!ID_RE.test(id)) return false;
  local.set("deviceUID", id);
  idb.set("deviceUID", id);
  S.myReports = [];
  S.details = {};
  local.del("myissues");
  emit("device");
  return true;
}

/** One draft per tab, as each iPhone tab keeps its own. */
const drafts = {};
export const draftFor = (tab) => (drafts[tab === "services" ? "services" : "report"] ||= new Draft(tab === "services" ? "services" : "report"));

export const contactSaved = () => ({ firstName: "", lastName: "", email: "", phone: "", ...local.get("contact", {}) });
export const saveContact = (c) => { local.set("contact", c); emit("contact"); };

// ---------- config ----------

export async function loadConfig() {
  S.config = await api("config");
  emit("config");
  return S.config;
}
export const cityId = () => S.config?.city || KANSAS_CITY;

// ---------- catalog ----------

function applyCatalog(tables) {
  const { categories, links } = readCatalog(tables);
  S.categories = categories;
  S.links = links;
}

export async function loadSavedCatalog() {
  const t = await idb.get("catalog");
  if (t) { applyCatalog(t); emit("catalog"); }
}

/** The catalog changes rarely, so a saved copy younger than 6 hours is kept unless `force`. */
export async function refreshCatalog(force = false) {
  if (!force && S.categories.length && Date.now() - local.get("catalogAt", 0) < 6 * 3600e3) return;
  try {
    const o = await api("catalog");
    applyCatalog(o.tables);
    await idb.set("catalog", o.tables);
    local.set("catalogAt", Date.now());
    S.catalogError = null;
  } catch (e) {
    if (!S.categories.length) S.catalogError = e.message;
  }
  emit("catalog");
}

// ---------- city notices ----------

let noticesAt = 0;
/** Reads the city's notices from the server, at most one time in ten minutes. The saved copy shows until then, and offline. */
export async function loadNotices() {
  if (Date.now() - noticesAt < 600e3) return S.notices;
  noticesAt = Date.now();
  try {
    const o = await api("notices");
    S.notices = Array.isArray(o.notices) ? o.notices : [];
    local.set("notices", S.notices);
    emit("notices");
  } catch {
    noticesAt = 0;
  }
  return S.notices;
}

/** The ids of the notices that the person took off the Report tab. */
export const hiddenNotices = () => local.get("noticesHidden", []).map(String);
export function hideNotice(id) {
  local.set("noticesHidden", [...new Set([...hiddenNotices(), String(id)])].slice(-50));
  emit("notices");
}

// ---------- my reports ----------

function applyMine(rows) {
  S.myReports = rows.map((r) => myReport(r));
}

export function loadSavedMine() {
  const rows = local.get("myissues");
  if (rows) { applyMine(rows); S.myState = "loaded"; }
}

export const visibleReports = () => S.myReports.filter((r) => !r.isUpdateRequest);

let mineRun = null;
export function loadMyReports() {
  mineRun ||= (async () => {
    if (!S.myReports.length) { S.myState = "loading"; emit("mine"); }
    try {
      const o = await api("myissues", { body: { device: deviceId() } });
      local.set("myissues", o.my_issues || []);
      applyMine(o.my_issues || []);
      S.myState = "loaded";
      S.myError = null;
      emit("mine");
      // The cards' status track reads staff notes from each open report's detail.
      const open = visibleReports().filter((r) => r.isOpen);
      await warmDetails(open.map((r) => r.id));
      for (const r of open) {
        if (Date.now() - (S.details[r.id]?.at || 0) > 10 * 60e3) await detail(r.id).catch(() => {});
      }
    } catch (e) {
      S.myState = S.myReports.length ? "loaded" : "failed";
      S.myError = e.message;
      emit("mine");
    } finally {
      mineRun = null;
    }
  })();
  return mineRun;
}

// ---------- details ----------

export async function warmDetails(ids) {
  for (const id of ids) {
    if (S.details[id]) continue;
    const v = await idb.get(`detail:${id}`);
    if (v) S.details[id] = v;
  }
  emit("detail");
}

export async function detail(id, scope = "mine") {
  const o = await api("detail", { body: { device: deviceId(), id, scope } });
  S.details[id] = { at: Date.now(), issue: o.issue };
  idb.set(`detail:${id}`, S.details[id]);
  emit("detail");
  return reportDetail(o.issue);
}

/**
 * Sends a REAL note to staff on one of my reports (a report or an update
 * request), with up to 4 photo blobs, then keeps the city's new detail.
 * Text alone goes as JSON; photos go as the city's photo ZIP.
 */
export async function addNote(id, text, photos = []) {
  let o;
  if (photos.length) {
    const now = Date.now();
    const entries = [];
    for (const [i, b] of photos.entries()) entries.push({ name: `CAM${now + i}.jpeg`, data: new Uint8Array(await b.arrayBuffer()) });
    const f = new FormData();
    f.append("device", deviceId());
    f.append("id", id);
    f.append("text", text);
    f.append("file_zip", zipStore(entries), `${now}_images.zip`);
    o = await api("note", { form: f });
  } else {
    o = await api("note", { body: { device: deviceId(), id, text } });
  }
  if (o.issue) {
    S.details[id] = { at: Date.now(), issue: o.issue };
    idb.set(`detail:${id}`, S.details[id]);
    emit("detail");
  }
  return o;
}

/**
 * Sends a REAL rating (1 to 5 stars, with an optional comment) of one of my
 * closed reports, then reads my reports again. The city keeps one rating for
 * each report. If the city's list is slow to show it, this device shows it.
 */
export async function rateReport(id, rating, text = "") {
  const o = await api("rate", { body: { device: deviceId(), id, rating, text } });
  if (!o.dry) local.set("ratedHere", { ...local.get("ratedHere", {}), [id]: rating });
  await loadMyReports().catch(() => {});
  emit("mine");
  return o;
}

/** The rating of one of my reports: the city's value, or the one this device sent. 0 when it has none. */
export const ratingOf = (r) => r?.rating || Number(local.get("ratedHere", {})[r?.id]) || 0;

export const cachedDetail = (id) => (S.details[id] ? reportDetail(S.details[id].issue) : null);

/** Anything an update request can name: one of my reports or a public pin. */
export const asTarget = (x) => ("submitted" in x
  ? { id: x.id, caseNumber: x.caseNumber, address: x.address, added: x.submitted ? new Date(x.submitted) : null, label: x.subtype || x.type, public: true }
  : x);

/** The update requests in my reports that name this report. */
export const updateRequestsFor = (t) => requestsNaming(t, S.myReports);

function merged(base, requests) {
  const d = { ...base, timeline: [...base.timeline] };
  for (const r of requests) {
    const rd = cachedDetail(r.id);
    if (!rd) continue;
    const at = rd.added || r.added;
    d.timeline.push({ title: "Update requested", details: `Update request ${r.id}, now ${rd.status}.`, when: dateTime(at), at, request: r.id });
    d.timeline.push(...rd.timeline.map((e) => ({ ...e, title: `Update request ${r.id}: ${e.title}`, request: r.id })));
  }
  d.timeline.sort((a, b) => (a.at?.getTime() || 0) - (b.at?.getTime() || 0));
  return d;
}

/** A report's detail, with each update request that names it merged into its timeline by time. */
export async function fullDetail(t) {
  const mine = S.myReports.some((r) => r.id === t.id);
  const base = await detail(t.id, mine ? "mine" : "public");
  const requests = updateRequestsFor(t);
  for (const r of requests) await detail(r.id).catch(() => {});
  return merged(base, requests);
}

export function cachedFullDetail(t) {
  const c = cachedDetail(t.id);
  return c ? merged(c, updateRequestsFor(t)) : null;
}

// ---------- map ----------

export async function loadSavedMaps() {
  for (const st of ["open", "closed", "all"]) {
    const v = await idb.get(`map-${st}`);
    if (v) S.map[st] = v;
  }
  emit("map");
}

/**
 * Public reports near a point. The city's map endpoint takes about 6 s per
 * call and answers HTTP 500 for some mixes of categories (each category
 * alone works), so the app asks in groups of 5, all at once, splits a failed
 * group into single categories, and shows pins as they land.
 */
export async function loadMap(center, status, force = false) {
  if (S.mapLoading.has(status)) return;
  const fresh15 = Date.now() - local.get(`mapAt-${status}`, 0) < 15 * 60e3;
  if (!force && fresh15 && S.mapCenter && meters(S.mapCenter, center) < 1500 && S.map[status]?.length) return;
  const names = reportCategories(S.categories).map((c) => c.name);
  if (!names.length) return;
  S.mapLoading.add(status);
  S.mapError = null;
  emit("map");
  const solo = new Set(local.get("mapSolo", []));
  const mixed = names.filter((n) => !solo.has(n));
  const groups = [];
  for (let i = 0; i < mixed.length; i += 5) groups.push(mixed.slice(i, i + 5));
  for (const n of names.filter((x) => solo.has(x))) groups.push([n]);
  const learned = new Set();
  const found = new Map();
  const shown = new Map((S.map[status] || []).map((i) => [i.id, i]));
  let failed = 0, offline = false, fatal = false;
  const call = async (types) => {
    const o = await api("map", { body: { device: deviceId(), lat: center.lat, lng: center.lng, status, types } });
    return (o.response_status?.response_data || []).map(mapIssue).filter(Boolean);
  };
  const isFatal = (e) => ["key_rejected", "no_key", "paused", "slow_down"].includes(e.code);
  await Promise.all(groups.map(async (g) => {
    let rows = null;
    try {
      rows = await call(g);
    } catch (e) {
      if (e.offline) offline = true;
      if (isFatal(e)) fatal = true;
      if (!fatal && !offline && g.length > 1) {
        g.forEach((n) => learned.add(n));
        const parts = await Promise.all(g.map((n) => call([n]).catch(() => null)));
        const ok = parts.filter(Boolean);
        rows = ok.length ? ok.flat() : null;
      }
    }
    if (!rows) { failed++; return; }
    for (const i of rows) { found.set(i.id, i); shown.set(i.id, i); }
    S.map[status] = [...shown.values()];
    emit("map");
  }));
  S.mapLoading.delete(status);
  if (failed === groups.length) {
    S.mapError = offline ? "No internet connection. Showing the last saved pins."
      : "The city's map did not answer. Showing the last saved pins. Tap refresh to try again.";
    emit("map");
    return;
  }
  if (learned.size) local.set("mapSolo", [...new Set([...solo, ...learned])]);
  S.map[status] = [...found.values()];
  S.mapCenter = center;
  local.set("mapCenter", center);
  local.set(`mapAt-${status}`, Date.now());
  idb.set(`map-${status}`, S.map[status]);
  emit("map");
}

/**
 * The open reports of one category within `within` meters of a point, nearest
 * first, for the report form. The city's app shows earlier reports of the
 * category on its location screen from a call that sends no position and
 * answers for the full city. This asks the public map call for one category
 * at the spot, so the answer is small.
 */
export async function nearbyOfType(type, subtype, at, within = 150) {
  const o = await api("map", { body: { device: deviceId(), lat: at.lat, lng: at.lng, status: "open", types: [type] } });
  return (o.response_status?.response_data || []).map(mapIssue).filter(Boolean)
    .map((i) => ({ ...i, meters: meters(at, i) }))
    .filter((i) => i.meters <= within && (!subtype || !i.subtype || i.subtype === subtype))
    .sort((a, b) => a.meters - b.meters);
}

// ---------- filing ----------

export async function checkDuplicate(d) {
  const loc = d.location, cat = d.category;
  if (!loc || !cat) return { level: "0", message: "" };
  return api("duplicate", { body: { device: deviceId(), payload: {
    latitude: String(loc.lat), longitude: String(loc.lng), address: loc.street, city: loc.city, state: loc.state, zip: loc.zip,
    type: cat.id, subtype: d.sub ? subId(d.sub) : "",
  } } });
}

async function send(issueJSON, zip, device, turnstile) {
  const f = new FormData();
  f.append("device", device);
  f.append("issue_details", issueJSON);
  if (zip) f.append("file_zip", zip, "images.zip");
  if (turnstile) f.append("turnstile", turnstile);
  const o = await api("submit", { form: f });
  return o.work_order || "";
}

/** Files a REAL report with the city. Returns the work order number. */
export async function submit(draft, contact, turnstile) {
  const { issue, zip } = await draft.payload(deviceId(), contact, cityId());
  return send(JSON.stringify(issue), zip, deviceId(), turnstile);
}

// ---------- offline queue ----------

export async function loadQueue() {
  S.queued = (await idb.get("queue")) || [];
  emit("queue");
}

export async function enqueue(draft, contact) {
  const { issue, zip } = await draft.payload(deviceId(), contact, cityId());
  S.queued.push({ id: crypto.randomUUID(), title: draft.title, issueJSON: JSON.stringify(issue), zip, created: Date.now() });
  await idb.set("queue", S.queued);
  emit("queue");
}

export async function dropQueued(id) {
  S.queued = S.queued.filter((q) => q.id !== id);
  await idb.set("queue", S.queued);
  emit("queue");
}

let flushing = false;
/** Sends queued reports in order. Stops at the first one that still cannot go. */
export async function flushQueue() {
  if (flushing || !S.queued.length) return;
  flushing = true;
  try {
    while (S.queued.length) {
      const q = S.queued[0];
      try {
        await send(q.issueJSON, q.zip, JSON.parse(q.issueJSON).deviceuid, await (await import("./robot.js")).robotToken());
      } catch (e) {
        // The city refused this one: keep it, with the reason, for the user to remove.
        if (e.status === 400 || e.status === 422) { q.error = e.message; await idb.set("queue", S.queued); emit("queue"); }
        break;
      }
      S.queued.shift();
      await idb.set("queue", S.queued);
      emit("queue");
    }
  } finally {
    flushing = false;
  }
  if (!S.queued.length) loadMyReports();
}

// ---------- update requests ----------

export { reference };

export function lastAsked(t) {
  const at = lastAskedAt(t, S.myReports);
  return at ? new Date(at) : null;
}

/** Why an update request is not allowed yet, or null. Requests open 7 days after filing and 7 days after the last request. */
export function tooSoon(t, now = Date.now()) {
  const added = t.added instanceof Date ? t.added : t.added ? new Date(t.added) : null;
  if (added && now - added < WEEK) return `Filed ${relative(added, now)}. Update requests open ${shortDate(new Date(added.getTime() + WEEK))}.`;
  const asked = lastAsked(t);
  if (asked && now - asked < WEEK) return `Update asked ${relative(asked, now)}. The next one opens ${shortDate(new Date(asked.getTime() + WEEK))}.`;
  return null;
}

export const isDue = (r, now = Date.now()) => dueForUpdate(r, S.myReports, now);

/** The filled "311 Request Update" form that names the report. */
export function updateDraft(t, method, contact) {
  const cat = updateCategory(S.categories);
  if (!cat) throw new Error("The city's update form is not loaded yet.");
  const reach = method === "Email" ? contact.email : contact.phone;
  const d = new Draft("update");
  d.category = cat;
  for (const q of d.questions) {
    const c = q.caption.toLowerCase();
    if (c.includes("request number")) d.answers[q.caption] = t.caseNumber || reference(t);
    else if (c.includes("location")) d.answers[q.caption] = t.address;
    else if (c.includes("contact information")) d.answers[q.caption] = reach;
    else if (q.kind === Kind.choice) {
      const o = q.options.find((x) => x.id === method);
      if (o) d.choiceAnswers[q.caption] = [o.id];
    }
  }
  const filed = t.added ? dateTime(t.added) : "";
  d.notes = `${UPDATE_TEXT} ${reference(t)}: ${t.label}${t.address ? ` at ${t.address}` : ""}${filed ? `, filed ${filed}` : ""}.`;
  return d;
}

/**
 * Files one "311 Request Update" naming the report. A REAL city request.
 * It passes the robot check as each report does. (From 2026-10-23 to
 * 2026-11-12 it sent no token, and the server refused each request that did
 * not come from the owner.)
 */
export async function fileUpdateRequest(t, method, contact) {
  const d = updateDraft(t, method, contact);
  return submit(d, contact, await (await import("./robot.js")).robotToken());
}

export const autoEnabled = () => local.get("autoRequestUpdates", true);

/** How the city answers an update request, from the saved contact details: { method, reach }, or null with no email and no phone. */
export function reachOf(contact = contactSaved()) {
  if (contact.email) return { method: "Email", reach: contact.email };
  if (contact.phone) return { method: "Phone Call", reach: contact.phone };
  return null;
}

/**
 * Keeps one filled update request for each open report in this device's
 * storage. The service worker sends one of them when the server says that a
 * report is due and the app is closed (sw.js). The contact details stay on
 * this device until then. With automatic requests off, or with no email and
 * no phone, the device keeps none. Returns the number kept.
 */
export async function prepareAsks() {
  const how = reachOf();
  if (!autoEnabled() || !how) { await idb.del("asks"); return 0; }
  // The catalog is not loaded yet: keep what is there.
  if (!updateCategory(S.categories)) return -1;
  const contact = contactSaved();
  const asks = {};
  for (const r of visibleReports().filter((x) => x.isOpen)) {
    const { issue } = await updateDraft(r, how.method, contact).payload(deviceId(), contact, cityId());
    asks[r.id] = { issueJSON: JSON.stringify(issue), label: r.label };
  }
  await idb.set("asks", asks);
  return Object.keys(asks).length;
}

/** Asks about every due report, if automatic requests are on and a contact is saved. At most every 6 hours. */
export async function autoRequestUpdates() {
  if (!autoEnabled()) return 0;
  const contact = contactSaved();
  const method = contact.email ? "Email" : "Phone Call";
  if (!(method === "Email" ? contact.email : contact.phone)) return 0;
  if (Date.now() - local.get("autoAt", 0) < 6 * 3600e3) return 0;
  local.set("autoAt", Date.now());
  await loadMyReports();
  const due = visibleReports().filter((r) => isDue(r));
  const filed = [];
  for (const r of due) {
    try { await fileUpdateRequest(r, method, contact); filed.push(r); } catch { /* try again next time */ }
  }
  if (filed.length) {
    await loadMyReports();
    notify("Asked the city for updates", filed.length === 1 ? `${filed[0].label} had no updates in 7 days.` : `${filed.length} reports had no updates in 7 days.`);
  }
  return filed.length;
}

/** A local notification when allowed, through the service worker. */
export async function notify(title, body) {
  try {
    if (Notification?.permission === "granted") {
      const reg = await navigator.serviceWorker?.ready;
      await reg?.showNotification(title, { body, icon: "/icons/icon-192.png", tag: "auto-updates" });
    }
  } catch { /* no notifications here */ }
}
