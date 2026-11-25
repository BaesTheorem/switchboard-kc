// The Home Screen offer at launch. A phone or tablet browser tab opens with
// this sheet in front of its first screen. It shows the way to install in
// this browser (install.js): the browser's own prompt where there is one,
// else the steps. A browser inside another app gets the way to a real
// browser. "Not now" closes the sheet for 90 days; the cards on Report sent,
// the Report tab and Settings stay.

import { canPrompt, copyButton, copyLink, here, inAppNote, installed, launchAnswered, onInstallChange, promptInstall, stepsList } from "../install.js";
import { html, icon, on, render } from "../lib/html.js";
import { sheet, snack } from "../ui.js";

export function openAddHome() {
  const p = here();
  const inApp = p.browser === "inapp";
  const body = () => html`<div class="stack">
    <div class="stack s8 centered">
      <img class="app-icon" src="/icons/icon-192.png" alt="" width="72" height="72">
      <p class="headline">Switchboard KC</p>
      <p class="sub muted">It opens like an app, keeps your reports on this device, and can send alerts when the city updates one.</p>
    </div>
    ${canPrompt()
      ? html`<button class="btn" type="button" data-install-act="prompt">${icon("install_mobile")}<span>Install the app</span></button>`
      : html`<div class="card stack s12">${inAppNote()}${stepsList()}${inApp ? copyButton() : ""}</div>`}
  </div>`;
  let done = false;   // installed from this sheet: the "anytime in Settings" line does not follow
  return sheet({
    title: inApp ? (p.os === "ios" ? "Open in Safari first" : "Open in your browser first") : "Add to Home Screen",
    start: { label: "Not now" },
    body: body(),
    mount: (el, close) => {
      // No tap comes before this sheet, so a browser draws the keyboard focus ring on the first button, and
      // "Not now" looks like the chosen answer. The title takes the focus: a screen reader starts there.
      const title = document.getElementById("sheet-title");
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
      // A new version of the app loads the page again under this sheet (app.js). Other sheets hold that back.
      const dialog = el.closest("dialog");
      dialog.dataset.launch = "";
      const offClick = on(el, "click", "[data-install-act]", async (_e, b) => {
        if (b.dataset.installAct === "copy") { await copyLink(); return; }
        b.disabled = true;
        if (await promptInstall()) { done = true; close(); snack("Installed. Open Switchboard KC from your Home Screen.", 6000); }
        else render(el, body());
      });
      // Chrome gives its prompt after a tap and 30 seconds on the page, which can be after this sheet opens.
      const offChange = onInstallChange(() => { if (installed()) { done = true; close(); } else render(el, body()); });
      return () => { offClick(); offChange(); delete dialog.dataset.launch; };
    },
    onClose: () => {
      launchAnswered();
      if (!done) snack("You can add it anytime in Settings, under Install.", 6000);
    },
  });
}
