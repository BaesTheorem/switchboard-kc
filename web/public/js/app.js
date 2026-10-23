// Start-up: theme, storage, routes, and the background work the iPhone app
// does at launch and on foreground (KC311App.swift): the API health check,
// the offline queue, my reports, the map, and automatic update requests.

import { onApiError } from "./api.js";
import { checkHealth, onKeyTrouble } from "./health.js";
import { $ } from "./lib/html.js";
import { DOWNTOWN, currentIfAllowed } from "./lib/geo.js";
import { local, persist } from "./lib/store.js";
import { route, start } from "./router.js";
import {
  autoRequestUpdates, deviceId, flushQueue, loadConfig, loadMap, loadMyReports, loadQueue, loadSavedCatalog,
  loadSavedMaps, loadSavedMine, recoverDeviceId, refreshCatalog, S,
} from "./state.js";
import "./install.js";   // listens for the install prompt from the start
import { applyAppearance } from "./theme.js";

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
// Reports tab
route("/reports", v("reports"), { title: "Reports", full: true });
route("/reports/updates", v("updates"), { title: "Request updates", parent: "/reports" });
route("/:tab/mine/:id", v("detail"), { parent: (p) => `/${p.split("/")[1]}` });
// City tab, and Health and help from the Report tab
route("/city", v("city"), { title: "City" });
route("/city/licenses", v("licenses"), { title: "License offices", parent: "/city" });
route("/city/transit", v("transit"), { title: "Buses and streetcar", parent: "/city" });
route("/city/meetings", v("meetings"), { title: "City meetings", parent: "/city" });
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
}

async function boot() {
  applyAppearance(local.get("appearance", "auto"));
  await recoverDeviceId();
  persist();
  loadSavedMine();
  await Promise.all([loadSavedCatalog(), loadQueue(), loadSavedMaps()]);
  start();

  let config;
  try {
    config = await loadConfig();
  } catch {
    config = null;   // offline: the saved copies carry the app until the server answers
  }
  if (config?.mode === "off") return;

  started = true;
  await refreshCatalog();
  // Start the map early: its city endpoint is slow.
  currentIfAllowed().then((here) => loadMap(here || S.mapCenter || DOWNTOWN, "open"));
  await loadMyReports();
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
