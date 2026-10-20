// Ticket alerts on the web (Push.swift). The server checks this id's reports
// every minute and pushes a notification when city staff change one. It keeps
// the reports id and this browser's push subscription, nothing else.
//
// iPhone and iPad allow web push only for an app added to the Home Screen
// (iOS 16.4 and later), and only after a tap, so the offer explains that.

import { api } from "../api.js";
import { html, icon, on } from "../lib/html.js";
import { local } from "../lib/store.js";
import { deviceId, S } from "../state.js";
import { snack } from "../ui.js";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** off | on | denied | unsupported | needs-install */
export async function alertState() {
  if (isIOS() && !installed()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && local.get("alertsFor") === deviceId() ? "on" : "off";
}

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Turns alerts on. Must run from a tap. */
export async function turnOn() {
  if (!supported()) throw new Error("This browser cannot show alerts.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are off for this app. Turn them on in the device settings.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(S.config.vapid) });
  await api("push/subscribe", { body: { device: deviceId(), previous: local.get("alertsFor"), subscription: sub.toJSON() } });
  local.set("alertsFor", deviceId());
  local.set("alertsChoice", "on");
}

export async function turnOff() {
  local.set("alertsChoice", "off");
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api("push/unsubscribe", { body: { device: local.get("alertsFor") || deviceId(), endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  local.del("alertsFor");
}

/** After Settings > Restore, move the subscription to the new id. */
export async function reportsIdChanged() {
  if ((await alertState()) === "off" && local.get("alertsChoice") === "on" && Notification.permission === "granted") {
    await turnOn().catch(() => {});
  }
}

export async function sendTest() {
  await api("push/test", { body: { device: deviceId() } });
  snack("A test alert is on its way.");
}

export const installSteps = () => isIOS()
  ? "In Safari, tap the Share button, then Add to Home Screen. Open the app from the Home Screen, then turn alerts on here."
  : "Use your browser's menu to install this app (Add to Home screen or Install app), then turn alerts on here.";

/** The offer shown after a report is sent, when the user has not chosen yet. */
export async function alertsOffer() {
  if (local.get("alertsChoice")) return null;
  const st = await alertState();
  if (st === "on" || st === "denied" || st === "unsupported") return null;
  if (st === "needs-install") {
    return html`<div class="card stack s8" style="text-align:left">
      <div class="row">${icon("notifications", "primary-text")}<span class="sub strong">Get an alert when the city updates it</span></div>
      <p class="caption muted">${installSteps()}</p>
    </div>`;
  }
  return html`<div class="card stack s12" style="text-align:left" id="offer">
    <div class="row">${icon("notifications", "primary-text")}<span class="sub strong grow">Get an alert when the city updates it</span></div>
    <div class="row"><button class="btn tonal" type="button" data-alerts="on">Turn on alerts</button>
      <button class="btn text" type="button" data-alerts="no">Not now</button></div>
  </div>`;
}

export function wireAlertsOffer(root) {
  return on(root, "click", "[data-alerts]", async (e, b) => {
    if (b.dataset.alerts === "no") { local.set("alertsChoice", "off"); root.querySelector("#offer")?.remove(); return; }
    try {
      await turnOn();
      root.querySelector("#offer")?.replaceWith(Object.assign(document.createElement("p"), { className: "sub done-text", textContent: "Alerts are on." }));
    } catch (err) {
      snack(err.message, 6000);
    }
  });
}
