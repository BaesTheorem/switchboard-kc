// Adding the web app to the Home Screen. An installed app keeps its storage
// (Safari deletes a site's storage after 7 days with no visit, but not an
// installed app's), and on iPhone and iPad it is the only way to get alerts.
// Chrome and Edge offer a real install prompt (beforeinstallprompt); Safari
// has none, so the app shows the steps for the browser it runs in.
//
// A phone or tablet browser tab gets the offer first: a sheet in front of the
// first screen (views/addhome.js). The cards on Report sent, the Report tab
// and Settings stay for later.
//
// The steps follow each maker's own instructions, read on 2026-11-24. Read
// them again when a new iOS comes out: Apple moved the Share button in 2025
// and again in 2026.
// - Safari on iPhone: Apple, iPhone User Guide, "Turn a website into an app in
//   Safari on iPhone". iOS 26: the More button, then Share. iOS 27: the Page
//   Menu button, then Share. The Bottom and Top tab layouts keep the Share
//   button in the toolbar, and so does the iPad.
// - Chrome on iPhone and on Android: Google, Chrome Help, "Use web apps".

import { html, icon } from "./lib/html.js";
import { platform } from "./lib/platform.js";
import { local, persist } from "./lib/store.js";
import { snack } from "./ui.js";

let deferred = null;
let added = false;   // the browser said that the person installed the app from this tab
const waiting = new Set();
// (The unit tests load this file with no window.)
globalThis.addEventListener?.("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  waiting.forEach((fn) => fn());
});
globalThis.addEventListener?.("appinstalled", () => { deferred = null; added = true; persist(); waiting.forEach((fn) => fn()); });

let known = null;
/** The device and browser of this page (lib/platform.js). */
export const here = () => (known ||= platform());
export const isIOS = () => here().os === "ios";
/** True in the Home Screen app, and in a browser tab after the person installed the app from it. */
export const installed = () => added || !!globalThis.matchMedia?.("(display-mode: standalone)").matches || globalThis.navigator?.standalone === true;
export const canPrompt = () => !!deferred;
/** Calls `fn` when the browser offers its install prompt, or the app is installed. Returns the remover. */
export const onInstallChange = (fn) => (waiting.add(fn), () => waiting.delete(fn));

/** Shows the browser's install prompt. True when the person installed. */
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({ outcome: "dismissed" }));
  return outcome === "accepted";
}

const INSTALL_WHY = "It opens like an app, keeps your reports id safe on this device, and can send alerts when the city updates a report.";

// In a step, an icon stands before the word it shows ("the ⋮ menu button"). An icon at the end of a sentence can go to the next line alone.
const name = (text) => html`<span class="strong">${text}</span>`;
const hint = (tpl) => html`<span class="hint">${tpl}</span>`;
const OPEN = "Open Switchboard KC from the Home Screen.";

/** The steps for a device and browser (lib/platform.js), as a list. */
export function installSteps(p = here()) {
  if (p.os === "ios") {
    // A browser inside another app has no Add to Home Screen. The way out is the app's own menu.
    if (p.browser === "inapp") return [
      html`Tap the ${icon("more_horiz", "inline")} menu button of this in-app browser.`,
      html`Tap ${name("Open in Safari")} or ${name("Open in browser")}.`,
      "Safari then shows how to add Switchboard KC to the Home Screen.",
    ];
    let share = html`Open this browser's ${icon("ios_share", "inline")} Share menu.${hint("If the toolbar does not show it, open the browser's menu first.")}`;
    if (p.browser === "chrome") share = html`Tap the ${icon("ios_share", "inline")} Share button at the right of Chrome's address bar.`;
    if (p.browser === "safari") {
      // Safari 26 put Share behind the More button, and Safari 27 behind the Page Menu button. The iPad kept it in the toolbar.
      share = !p.ipad && p.version >= 26
        ? html`Tap the ${p.version >= 27 ? icon("notes", "inline") : icon("more_horiz", "inline")} menu button in Safari's toolbar, then tap ${name("Share")}.${hint(html`If the toolbar has the ${icon("ios_share", "inline")} Share button, tap that.`)}`
        : html`Tap the ${icon("ios_share", "inline")} Share button in Safari's toolbar.`;
    }
    return [
      share,
      html`Tap ${icon("add_box", "inline")} ${name("Add to Home Screen")}.${hint(html`If you do not see it, scroll down or tap ${name("View More")}.`)}`,
      p.version >= 26 ? html`Keep ${name("Open as Web App")} on, then tap ${name("Add")}.` : html`Tap ${name("Add")}.`,
      OPEN,
    ];
  }
  if (p.os === "android") {
    if (p.browser === "inapp") return [
      html`Tap the ${icon("more_vert", "inline")} menu button of this in-app browser.`,
      html`Tap ${name("Open in Chrome")} or ${name("Open in browser")}.`,
      "The browser then shows how to add Switchboard KC to the Home Screen.",
    ];
    if (p.browser === "chrome") return [
      html`Tap the ${icon("more_vert", "inline")} menu button at the right of Chrome's address bar.`,
      html`Tap ${name("Install and create shortcut")}.${hint(html`An older Chrome names it ${name("Add to Home screen")} or ${name("Install app")}.`)}`,
      html`Tap ${name("Install")}.`,
      OPEN,
    ];
    return [
      html`Tap the ${icon("more_vert", "inline")} menu button of the browser.`,
      html`Tap ${name("Add to Home screen")} or ${name("Install")}.`,
      OPEN,
    ];
  }
  return [
    html`Tap the ${icon("more_vert", "inline")} menu button at the top of the browser.`,
    "Tap Install app or Add to Home screen.",
    OPEN,
  ];
}

export const stepsList = () => html`<ol class="steps">${installSteps().map((s) => html`<li class="sub">${s}</li>`)}</ol>`;

/** In a browser inside another app: why the steps start with a move to a real browser. "" in a real browser. */
export function inAppNote(p = here()) {
  if (p.browser !== "inapp") return "";
  return html`<p class="sub">${p.app || "This app"}'s built-in browser cannot add an app to the Home Screen. Open this page in ${p.os === "ios" ? "Safari" : "your browser"} first.</p>`;
}

/** For an in-app browser with no "Open in browser" in its menu: the address, for a paste into a real browser. */
export const copyButton = () => html`<button class="btn tonal" type="button" data-install-act="copy">${icon("content_copy")}<span>Copy the link</span></button>`;

export async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    snack(`Link copied. Paste it in ${isIOS() ? "Safari" : "your browser"}.`, 6000);
  } catch {
    snack("The copy did not work here. Use the menu of this in-app browser.", 6000);
  }
}

/** The way to install here: the browser's own prompt behind a button, or the steps for this browser. */
export function installWays() {
  if (canPrompt()) return html`<button class="btn tonal" type="button" data-install-act="prompt">${icon("install_mobile")}<span>Install the app</span></button>`;
  return html`${inAppNote()}${stepsList()}${here().browser === "inapp" ? copyButton() : ""}`;
}

/**
 * The install card, or "" when the app is installed or the person closed the
 * card. `why` is the first line, for the screen that shows it.
 */
export function installCard(why = "Add Switchboard KC to your Home Screen") {
  if (installed() || local.get("installCardClosed")) return "";
  return html`<section class="card stack s12" style="text-align:left" aria-labelledby="inst-h" data-install-card>
    <div class="row">${icon("install_mobile", "primary-text")}<h2 class="sub strong grow" id="inst-h">${why}</h2></div>
    <p class="caption muted">${INSTALL_WHY}</p>
    ${installWays()}
    <button class="btn text" type="button" data-install-act="close">Not now</button>
  </section>`;
}

/** Wires the install buttons inside `root`; `repaint` draws them again. Returns the remover. */
export function wireInstallCard(root, repaint) {
  const click = async (e) => {
    const b = e.target.closest("[data-install-act]");
    if (!b || !root.contains(b)) return;
    const act = b.dataset.installAct;
    if (act === "copy") { await copyLink(); return; }
    if (act === "close") local.set("installCardClosed", Date.now());
    else await promptInstall();
    repaint();
  };
  root.addEventListener("click", click);
  const off = onInstallChange(repaint);
  return () => { root.removeEventListener("click", click); off(); };
}

// ---------- the offer at launch ----------

// How long "Not now" lasts. Chrome shows its own install banner again about 90
// days after the first time (web.dev, "Patterns for promoting PWA
// installation"), and this app takes that banner's place.
export const ASK_AGAIN = 90 * 86400e3;

/**
 * True when the launch sheet is due: a phone or tablet browser tab, not the
 * installed app, and no "Not now" in the last 90 days.
 */
export function launchDue({ p = here(), isInstalled = installed(), asked = local.get("installAsked"), now = Date.now() } = {}) {
  return p.mobile && !isInstalled && !(now - (Number(asked) || 0) < ASK_AGAIN);
}

/** Records that the person saw the launch sheet and closed it. */
export const launchAnswered = () => local.set("installAsked", Date.now());
