// Hash routes. The first path segment is the tab (report, services, reports,
// city); each tab keeps its own place, as the iPhone app's tab stacks do.
//
// A view module exports `default (main, params, ctx) => cleanup?`. It renders
// into `main`, sets its title with ctx.title(), and returns a function that
// removes its listeners.

import { $, $$ } from "./lib/html.js";
import { setTitle, closeSheet } from "./ui.js";

const routes = [];
const lastPath = { report: "/report", services: "/services", reports: "/reports", city: "/city" };
const scrollAt = new Map();
let cleanup = null;
let currentPath = "";
let seq = 0;

/** Registers a route. `pattern` like "/services/section/:id"; `load` returns the view module. */
export function route(pattern, load, opts = {}) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; })}$`);
  routes.push({ pattern, re, keys, load, ...opts });
}

export const path = () => decodeURI(location.hash.replace(/^#/, "").split("?")[0]) || "/report";
export const tabOf = (p) => p.split("/")[1] || "report";
const depth = () => history.state?.depth || 0;

export function go(to, { replace = false } = {}) {
  const sameTab = tabOf(to) === tabOf(path());
  const state = { depth: replace ? depth() : sameTab ? depth() + 1 : 0 };
  if (replace) history.replaceState(state, "", `#${to}`);
  else history.pushState(state, "", `#${to}`);
  run();
}

/** Back within the tab: the browser's back when the last step was in-app, else the parent path. */
export function back() {
  if (depth() > 0) history.back();
  else go(parentOf(path()), { replace: true });
}

function parentOf(p) {
  const r = routes.find((x) => x.re.test(p));
  if (r?.parent) return typeof r.parent === "function" ? r.parent(p) : r.parent;
  return p.split("/").slice(0, -1).join("/") || "/report";
}

export function tabRoot(tab) { return `/${tab}`; }

/** A tab tap: its last place, or its root when it is already showing. */
export function openTab(tab) {
  const p = path();
  go(tabOf(p) === tab ? tabRoot(tab) : lastPath[tab] || tabRoot(tab), { replace: tabOf(p) === tab });
}

async function run() {
  const p = path();
  const r = routes.find((x) => x.re.test(p));
  if (!r) { go("/report", { replace: true }); return; }
  const mine = ++seq;
  if (currentPath) scrollAt.set(currentPath, window.scrollY);
  closeSheet();
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = null;
  const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(r.re.exec(p)[i + 1])]));
  const tab = tabOf(p);
  lastPath[tab] = p;
  currentPath = p;
  $$("#tabs a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $("#back").hidden = p.split("/").length <= 2;
  const main = $("#view");
  main.className = r.full ? "full" : "";
  const mod = await r.load();
  if (mine !== seq) return;
  main.replaceChildren();
  setTitle(r.title || "Switchboard KC");
  const ctx = { tab, path: p, go, back, title: setTitle };
  try {
    cleanup = (await mod.default(main, params, ctx)) || null;
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="screen"><div class="error-box">This screen did not load: ${String(e.message || e).replace(/[<>&]/g, "")}</div></div>`;
  }
  if (mine !== seq) return;
  window.scrollTo(0, history.state?.restore === false ? 0 : scrollAt.get(p) || 0);
  if (document.activeElement === document.body || !main.contains(document.activeElement)) main.focus({ preventScroll: true });
}

export function start() {
  window.addEventListener("popstate", run);
  // A typed or linked hash (not a history step, which popstate already ran).
  window.addEventListener("hashchange", () => {
    if (path() === currentPath) return;
    if (!history.state) history.replaceState({ depth: 0 }, "");
    run();
  });
  $("#back").addEventListener("click", back);
  // Every in-app link goes through go(), so Back returns to the screen it came from.
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
    e.preventDefault();
    go(a.getAttribute("href").slice(1));
  });
  $("#tabs").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-tab]");
    if (!a) return;
    e.preventDefault();
    openTab(a.dataset.tab);
  });
  if (!history.state) history.replaceState({ depth: 0 }, "");
  run();
}
