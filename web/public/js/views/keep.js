// Cards that keep a person's reports safe: save the reports id to a passkey,
// and on a new device, restore it from one (passkey.js). The Report tab and
// the Report sent screen show them; Settings > My reports has the same buttons.

import { html, icon } from "../lib/html.js";
import { local } from "../lib/store.js";
import { passkeysSupported, restoreFromPasskey, saveToPasskey, savedToPasskey } from "../passkey.js";
import { deviceId, loadMyReports, useDeviceId } from "../state.js";
import { snack } from "../ui.js";
import { reportsIdChanged } from "./alerts.js";

/** "Save to a passkey", or "" when it is saved, closed, or not possible here. */
export function keepCard() {
  if (!passkeysSupported() || savedToPasskey(deviceId()) || local.get("keepCardClosed")) return "";
  return html`<section class="card stack s12" style="text-align:left" aria-labelledby="keep-h">
    <div class="row">${icon("passkey", "primary-text")}<h2 class="sub strong grow" id="keep-h">Keep your reports if you lose this phone</h2></div>
    <p class="caption muted">The city keeps your reports under an id on this device. Save the id to a passkey, and your password manager keeps a copy for your other devices.</p>
    <button class="btn tonal" type="button" data-keep="save">${icon("passkey")}<span>Save to a passkey</span></button>
    <button class="btn text" type="button" data-keep="close-keep">Not now</button>
  </section>`;
}

/** "Restore with a passkey", for a device with no reports yet. */
export function restoreCard() {
  if (!passkeysSupported() || local.get("passkeyFor") || local.get("restoreCardClosed")) return "";
  return html`<section class="card stack s12" style="text-align:left" aria-labelledby="rest-h">
    <div class="row">${icon("passkey", "primary-text")}<h2 class="sub strong grow" id="rest-h">Used Switchboard KC before?</h2></div>
    <p class="caption muted">If you saved your reports to a passkey, get them back here.</p>
    <button class="btn tonal" type="button" data-keep="restore">${icon("passkey")}<span>Restore with a passkey</span></button>
    <button class="btn text" type="button" data-keep="close-restore">Not now</button>
  </section>`;
}

/** Saves the current id to a passkey, with a message. True when it worked. */
export async function saveNow() {
  try {
    await saveToPasskey(deviceId());
    snack("Saved. Your password manager now keeps your reports id.");
    return true;
  } catch (e) {
    snack(e.message, 6000);
    return false;
  }
}

/** Restores an id from a passkey and loads its reports. True when it worked. */
export async function restoreNow() {
  try {
    const id = await restoreFromPasskey();
    useDeviceId(id);
    await loadMyReports();
    await reportsIdChanged();
    snack("Restored. Your reports are back.");
    return true;
  } catch (e) {
    snack(e.message, 6000);
    return false;
  }
}

/** Wires the cards' buttons inside `root`; `repaint` draws them again. Returns the remover. */
export function wireKeep(root, repaint) {
  const click = async (e) => {
    const b = e.target.closest("[data-keep]");
    if (!b || !root.contains(b)) return;
    const act = b.dataset.keep;
    if (act === "close-keep") local.set("keepCardClosed", Date.now());
    else if (act === "close-restore") local.set("restoreCardClosed", Date.now());
    else {
      b.disabled = true;
      if (act === "save") await saveNow(); else await restoreNow();
    }
    repaint();
  };
  root.addEventListener("click", click);
  return () => root.removeEventListener("click", click);
}
