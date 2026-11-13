// Start-up: theme, storage, routes, and the background work the iPhone app
// does at launch and on foreground (KC311App.swift): the API health check,
// the offline queue, my reports, the map, and automatic update requests.

import { onApiError } from "./api.js";
import { checkHealth, onKeyTrouble } from "./health.js";
import { $ } from "./lib/html.js";
import { DOWNTOWN, currentIfAllowed } from "./lib/geo.js";
import { local, persist } from "./lib/store.js";
import { reportScope } from "./models.js";
import { route, start } from "./router.js";
import {
  autoRequestUpdates, deviceId, flushQueue, listen, loadConfig, loadMap, loadMyReports, loadQueue, loadSavedCatalog,
  loadSavedMaps, loadSavedMine, prepareAsks, recoverDeviceId, refreshCatalog, S, visibleReports,
} from "./state.js";
import "./install.js";   // listens for the install prompt from the start
import { recordStart } from "./startup.js";
import { applyAppearance } from "./theme.js";

// Start times for Settings > Details, in ms since the page began to load. Every script is in at this line.
const marks = { files: performance.now() };

// A deploy brings a new service worker, and it takes over while this page
// still runs the scripts of the old version. A screen that loads after that
// comes from the new version and does not fit the old scripts (a new card
// with no route for it, which sent a tap to the home screen on 2026-11-12).
// So the page loads again, one time, when a new worker takes over. It waits
// while a person fills a form or has a sheet open, until the next screen.
if ("serviceWorker" in navigator) {
  let worker = navigator.serviceWorker.controller, waiting = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const first = !worker;   // the first install: the page and the worker have the same version
    worker = navigator.serviceWorker.controller;
    if (first || waiting) return;
    const again = () => { sessionStorage.setItem("workerReload", String(Date.now())); location.reload(); };
    const busy = /\/(form|streetcar)\b/.test(location.hash) || !!document.querySelector("dialog[open], .picker")
      || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    // After a reload a moment ago, the next one also waits for the person. So a worker file that changes at each read cannot make a loop.
    const recent = Date.now() - Number(sessionStorage.getItem("workerReload") || 0) < 15000;
    if (busy || recent) { waiting = true; addEventListener("hashchange", again, { once: true }); } else again();
  });
}

const v = (name) => () => import(`./views/${name}.js`);

// Report tab
route("/report", v("report"), { title: "Switchboard KC" });
route("/report/what", v("services"), { title: "What is wrong?", parent: "/report" });
// Services tab
route("/services", v("services"), { title: "Services" });
// Shared by the Report and Services tabs (each keeps its own draft)
route("/:tab/section/:id", v("section"), { parent: (p) => `/${p.split("/")[1]}${p.startsWith("/report") ? "/what" : ""}` });
route("/:tab/all", v("all"), { title: "Everything, A to Z", parent: (p) => `/${p.split("/")[1]}${p.startsWith("/report") ? "/what" : ""}` });
route("/:tab/form", v("form"), { title: "Details" });
route("/:tab/done", v("done"), { title: "Report sent", parent: (p) => `/${p.split("/")[1]}` });
route("/:tab/streetcar", v("streetcar"), { title: "Streetcar" });
route("/:tab/police", v("police"), { title: "Police report" });
route("/:tab/pay", v("pay"), { title: "Pay" });
// Reports tab
route("/reports", v("reports"), { title: "Reports", full: true });
route("/reports/updates", v("updates"), { title: "Request updates", parent: "/reports" });
route("/:tab/mine/:id", v("detail"), { parent: (p) => `/${p.split("/")[1]}` });
// City tab, and Health and help from the Report tab
route("/city", v("city"), { title: "City" });
route("/city/licenses", v("licenses"), { title: "License offices", parent: "/city" });
route("/city/transit", v("transit"), { title: "Buses and streetcar", parent: "/city" });
route("/meetings", v("meetings"), { title: "City meetings" });
// The screen was under City until 2026-10-24; old links go to the tab.
route("/city/meetings", async () => ({ default: (_main, _params, ctx) => { ctx.go("/meetings", { replace: true }); } }));
route("/:tab/help", v("help"), { title: "Health and help", parent: (p) => `/${p.split("/")[1]}` });
route("/:tab/help/:kind", v("places"), { parent: (p) => p.split("/").slice(0, 3).join("/") });

$("#cog").addEventListener("click", async () => (await import("./views/settings.js")).openSettings());
addEventListener("scroll", () => $("#appbar").classList.toggle("scrolled", scrollY > 4), { passive: true });

onApiError((e) => {
  if (["key_rejected", "no_key"].includes(e.code)) onKeyTrouble(e.code);
});

let started = false;
/** The work the app does at launch and each time it comes back to the foreground. */
async function foreground() {
  await checkHealth();
  await flushQueue();
  await autoRequestUpdates();
  keepAsksReady();
}

let asksTimer = 0;
/**
 * For the time when the app is closed: this device keeps a filled update
 * request for each open report, and the server knows that this device sends
 * them (state.js prepareAsks, views/alerts.js syncAuto). Runs again after the
 * reports, the contact details or the switch change.
 */
function keepAsksReady() {
  clearTimeout(asksTimer);
  asksTimer = setTimeout(async () => {
    if (!started) return;
    try {
      await prepareAsks();
      await (await import("./views/alerts.js")).syncAuto();
    } catch { /* the next start tries again */ }
  }, 1500);
}
listen("mine", keepAsksReady);
listen("contact", keepAsksReady);
listen("catalog", keepAsksReady);

async function boot() {
  applyAppearance(local.get("appearance", "auto"));
  await recoverDeviceId();
  marks.id = performance.now();
  persist();
  loadSavedMine();
  await Promise.all([loadSavedCatalog(), loadQueue(), loadSavedMaps()]);
  marks.saved = performance.now();
  start();
  marks.screen = performance.now();
  recordStart(marks);

  let config;
  try {
    config = await loadConfig();
  } catch {
    config = null;   // offline: the saved copies carry the app until the server answers
  }
  if (config?.mode === "off") return;

  started = true;
  await refreshCatalog();
  // Start everyone's map early, because its city endpoint is slow, but only
  // when the Reports tab shows it: the person chose everyone's, or this
  // device has no reports. A person with reports sees their own list first.
  const everyone = () => reportScope(local.get("reportsOnlyMine", true), visibleReports().length, S.myState) === "everyone";
  const warmMap = () => currentIfAllowed().then((here) => loadMap(here || S.mapCenter || DOWNTOWN, "open"));
  const early = everyone();
  if (early) warmMap();
  await loadMyReports();
  if (!early && everyone()) warmMap();
  await foreground();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  deviceId();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && started) {
    foreground();
    loadMyReports();
  }
});
addEventListener("online", () => started && flushQueue());

boot();
