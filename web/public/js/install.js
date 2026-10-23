// Adding the web app to the Home Screen. An installed app keeps its storage
// (Safari deletes a site's storage after 7 days with no visit, but not an
// installed app's), and on iPhone and iPad it is the only way to get alerts.
// Chrome and Edge offer a real install prompt (beforeinstallprompt); Safari
// has none, so the card shows the steps.

import { html, icon } from "./lib/html.js";
import { local, persist } from "./lib/store.js";

let deferred = null;
const waiting = new Set();
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  waiting.forEach((fn) => fn());
});
addEventListener("appinstalled", () => { deferred = null; persist(); waiting.forEach((fn) => fn()); });

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
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

/** The steps for this device, as a list. */
export function installSteps() {
  if (isIOS()) {
    return [
      html`Tap the Share button ${icon("ios_share", "inline")} in Safari's toolbar.`,
      "Scroll down and tap Add to Home Screen, then Add.",
      "Open Switchboard KC from the Home Screen.",
    ];
  }
  return [
    html`Tap the menu button ${icon("more_vert", "inline")} at the top of the browser.`,
    "Tap Install app or Add to Home screen.",
    "Open Switchboard KC from the Home Screen.",
  ];
}

export const stepsList = () => html`<ol class="steps">${installSteps().map((s) => html`<li class="sub">${s}</li>`)}</ol>`;

/**
 * The install card, or "" when the app is installed or the person closed the
 * card. `why` is the first line, for the screen that shows it.
 */
export function installCard(why = "Add Switchboard KC to your Home Screen") {
  if (installed() || local.get("installCardClosed")) return "";
  return html`<section class="card stack s12" style="text-align:left" aria-labelledby="inst-h" data-install-card>
    <div class="row">${icon("install_mobile", "primary-text")}<h2 class="sub strong grow" id="inst-h">${why}</h2></div>
    <p class="caption muted">It opens like an app, keeps your reports id safe on this device, and can send alerts when the city updates a report.</p>
    ${canPrompt()
      ? html`<button class="btn tonal" type="button" data-install-act="prompt">${icon("install_mobile")}<span>Install the app</span></button>`
      : stepsList()}
    <button class="btn text" type="button" data-install-act="close">Not now</button>
  </section>`;
}

/** Wires the card's buttons inside `root`; `repaint` draws it again. Returns the remover. */
export function wireInstallCard(root, repaint) {
  const click = async (e) => {
    const b = e.target.closest("[data-install-act]");
    if (!b || !root.contains(b)) return;
    if (b.dataset.installAct === "close") local.set("installCardClosed", Date.now());
    else await promptInstall();
    repaint();
  };
  root.addEventListener("click", click);
  const off = onInstallChange(repaint);
  return () => { root.removeEventListener("click", click); off(); };
}
