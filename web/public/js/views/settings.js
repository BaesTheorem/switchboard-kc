// Settings, from the cog on every screen: appearance, installing the app,
// ticket alerts, the city API (status and key repair), the reports id (copy,
// save, restore), this server's access, the owner's tools, and the credits.
// Ported from SettingsView in OtherTabs.swift.

import { api } from "../api.js";
import { checkHealth, H, repairKey } from "../health.js";
import { dateTime, relative } from "../lib/format.js";
import { html, icon, on, render } from "../lib/html.js";
import { local } from "../lib/store.js";
import { deviceId, listen, loadMyReports, S, useDeviceId } from "../state.js";
import { applyAppearance } from "../theme.js";
import { sheet, snack } from "../ui.js";
import { alertState, installed, installSteps, reportsIdChanged, sendTest, turnOff, turnOn } from "./alerts.js";

let installPrompt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });

const statusText = () => ({
  unknown: "Not checked yet", ok: "Working", offline: "No connection to the server", error: "The server did not answer",
  rejected: "The city changed its key", no_key: "The server has no city key yet", broken: H.failure || "Not working",
}[H.status] || H.status);
const statusClass = () => (H.status === "ok" ? "done-text" : ["unknown", "offline"].includes(H.status) ? "muted" : "error-text");

export function openSettings() {
  let alerts = "off", restoreNote = "", ownerOpen = !!local.get("ownerToken"), ownerMsg = "";
  const body = () => html`<div class="stack s20">
    <section class="stack s8" aria-labelledby="ap-h"><h3 class="label" id="ap-h">Appearance</h3>
      <div class="seg" role="group" aria-label="Theme">
        ${[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => html`<button type="button" data-theme="${k}" aria-pressed="${String(local.get("appearance", "auto") === k)}">${l}</button>`)}
      </div></section>

    ${installed() ? "" : html`<section class="stack s8" aria-labelledby="in-h"><h3 class="label" id="in-h">Install</h3>
      <div class="card stack s8"><p class="sub">${installPrompt ? "Install this app to open it from your home screen, keep your reports id safe, and get alerts." : installSteps()}</p>
        ${installPrompt ? html`<button class="btn tonal" type="button" data-install>${icon("install_mobile")}<span>Install the app</span></button>` : ""}</div></section>`}

    <section class="stack s8" aria-labelledby="al-h"><h3 class="label" id="al-h">Ticket alerts</h3>
      <div class="rows">
        <label class="toggle-row" for="al-on">${icon("notifications", "primary-text")}<span class="grow sub">Alert me when the city updates a report</span>
          <span class="switch"><input type="checkbox" id="al-on" ${alerts === "on" ? "checked" : ""} ${["needs-install", "denied", "unsupported"].includes(alerts) ? "disabled" : ""}><span></span></span></label>
        ${alerts === "on" ? html`<div class="row" style="padding:8px 16px"><span class="caption muted grow">Checking every minute</span><button class="btn text" type="button" data-test>Send a test</button></div>` : ""}
        ${alerts === "needs-install" ? html`<p class="caption muted" style="padding:12px 16px">${installSteps()}</p>` : ""}
        ${alerts === "denied" ? html`<p class="caption error-text" style="padding:12px 16px">Notifications are blocked for this app. Allow them in the device or browser settings.</p>` : ""}
        ${alerts === "unsupported" ? html`<p class="caption muted" style="padding:12px 16px">This browser cannot show alerts.</p>` : ""}
      </div>
      <p class="caption muted">The alert server checks your reports every minute and sends a notification when city staff change one. It keeps your reports id and this device's push address, nothing else. Turn this off to delete them.</p></section>

    <section class="stack s8" aria-labelledby="api-h"><h3 class="label" id="api-h">City API</h3>
      <div class="rows">
        <div class="row" style="padding:14px 16px"><span class="sub grow">Status</span><span class="sub ${statusClass()}" style="text-align:right">${H.progress || statusText()}</span></div>
        ${H.lastCheck ? html`<div class="row" style="padding:14px 16px"><span class="sub grow">Last check</span><span class="sub muted">${relative(H.lastCheck)}</span></div>` : ""}
        <button class="item" type="button" data-check ${H.repair ? "disabled" : ""}><span class="grow sub">Check the API now</span></button>
        <button class="item" type="button" data-key ${H.repair ? "disabled" : ""}><span class="grow stack s4" style="gap:2px"><span class="sub">Update the city API key</span>
          <span class="caption muted">${H.progress || (local.get("keyRefreshed") ? `Last updated ${relative(local.get("keyRefreshed"))}` : "Not needed so far")}</span></span></button>
      </div>
      <p class="caption muted">The app checks the city's API every 6 hours and repairs it by itself. "Update the city API key" downloads the city's newest Android app (about 44 MB) and reads the key from it. Use it only if reports stop going through.</p></section>

    <section class="stack s8" aria-labelledby="dt-h"><h3 class="label" id="dt-h">Details</h3>
      <div class="rows">
        <div class="row" style="padding:14px 16px"><span class="sub grow">City app version</span><span class="sub muted">${H.detail?.key?.app_version || "none"}</span></div>
        <div class="row" style="padding:14px 16px"><span class="sub grow">API address</span><span class="sub muted">${H.detail?.key?.host || ""}</span></div>
        ${H.detail?.key?.updated ? html`<div class="row" style="padding:14px 16px"><span class="sub grow">Key set</span><span class="sub muted">${dateTime(H.detail.key.updated)}</span></div>` : ""}
      </div></section>

    <section class="stack s8" aria-labelledby="id-h"><h3 class="label" id="id-h">My reports</h3>
      <div class="rows">
        <div class="row" style="padding:14px 16px"><span class="sub grow">Your reports id</span><span class="sub code" style="user-select:all">${deviceId()}</span></div>
        <div class="row wrap" style="padding:8px 12px"><button class="btn text" type="button" data-copy>${icon("content_copy")}<span>Copy it</span></button>
          <button class="btn text" type="button" data-save>${icon("download")}<span>Save a copy</span></button></div>
        <div class="stack s8" style="padding:12px 16px"><label class="caption muted" for="rid">Paste an id to restore</label>
          <input class="input code" id="rid" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="16 characters, 0 to 9 and a to f">
          <button class="btn tonal" type="button" data-restore>Restore my reports</button>
          ${restoreNote ? html`<p class="caption muted" role="status">${restoreNote}</p>` : ""}</div>
      </div>
      <p class="caption muted">The city has no accounts: it keeps your reports under this id. This app saves it on this device only. Keep a copy: if you delete the app or clear this site's data, the id is gone, and with it the list. The iPhone app can use the same id.</p></section>

    <section class="stack s8" aria-labelledby="sv-h"><h3 class="label" id="sv-h">This server</h3>
      <div class="rows">
        <div class="row" style="padding:14px 16px"><span class="sub grow">Access</span><span class="sub muted">${S.config?.mode === "off" ? "Paused" : "Open to anyone"}</span></div>
        ${S.config?.submitDaily ? html`<div class="row" style="padding:14px 16px"><span class="sub grow">Reports a day</span><span class="sub muted">${S.config.submitDaily}</span></div>` : ""}
      </div>
      <details ${ownerOpen || S.config?.admin ? "open" : ""} id="owner"><summary class="caption muted" style="cursor:pointer;min-height:44px;display:flex;align-items:center">Owner tools</summary>
        ${ownerTools()}</details></section>

    <p class="foot muted centered" style="padding:8px 8px 0">Provided by Kansas City Effective Altruism. <a class="primary-text" href="https://www.eakansascity.org" target="_blank" rel="noopener">Come check us out!</a><br><br>
      An unofficial app. It is not made, approved, or supported by the City of Kansas City, Missouri, Tyler Technologies, or the KC Streetcar Authority. For an emergency, call 911.<br><br>
      <a class="primary-text" href="https://github.com/BaesTheorem/switchboard-kc" target="_blank" rel="noopener">Source code</a> · Maps by OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors.</p>
  </div>`;

  const ownerTools = () => {
    if (!S.config?.admin) {
      return html`<div class="card stack s8"><label class="caption muted" for="own-t">Owner token</label>
        <input class="input code" id="own-t" type="password" autocomplete="off" placeholder="ADMIN_TOKEN">
        <button class="btn tonal" type="button" data-own>Unlock owner tools</button>
        ${ownerMsg ? html`<p class="caption error-text">${ownerMsg}</p>` : ""}</div>`;
    }
    return html`<div class="stack s12">
      <div class="card stack s8"><p class="sub strong">Access</p>
        <div class="seg" role="group" aria-label="Server access">${[["open", "Open"], ["off", "Paused"]].map(([k, l]) => html`<button type="button" data-mode="${k}" aria-pressed="${String(S.config.mode === k)}">${l}</button>`)}</div>
        <p class="caption muted">Open lets anyone use this server (with the robot check, when set). Paused stops every city call.</p></div>
      <button class="btn text" type="button" data-unown>Forget the owner token on this device</button>
    </div>`;
  };

  let root;
  const paint = () => { if (root) render(root, body()); };
  const offs = [];
  sheet({
    title: "Settings",
    start: null,
    end: { label: "Done", act: (close) => close() },
    body: body(),
    mount: (el) => {
      root = el;
      alertState().then((s) => { alerts = s; paint(); });
      offs.push(listen("health", paint), listen("config", paint));
      const h = (sel, fn, type = "click") => offs.push(on(el, type, sel, fn));
      h("[data-theme]", (e, b) => { local.set("appearance", b.dataset.theme); applyAppearance(b.dataset.theme); paint(); });
      h("[data-install]", async () => { await installPrompt?.prompt(); installPrompt = null; paint(); });
      h("#al-on", async (e) => {
        try {
          if (e.target.checked) await turnOn(); else await turnOff();
        } catch (x) { snack(x.message, 6000); }
        alerts = await alertState();
        paint();
      }, "change");
      h("[data-test]", () => sendTest().catch((x) => snack(x.message)));
      h("[data-check]", async () => { await checkHealth(true); paint(); });
      h("[data-key]", () => repairKey(true));
      h("[data-copy]", async () => { await navigator.clipboard?.writeText(deviceId()); snack("Copied your reports id."); });
      h("[data-save]", () => saveId());
      h("[data-restore]", async () => {
        const v = el.querySelector("#rid").value;
        if (useDeviceId(v)) {
          restoreNote = "Restored. Your reports now shows the reports filed under this id.";
          paint();
          await loadMyReports();
          await reportsIdChanged();
        } else {
          restoreNote = "An id is 16 characters, 0 to 9 and a to f.";
          paint();
        }
      });
      h("[data-own]", async () => {
        ownerOpen = true;
        local.set("ownerToken", el.querySelector("#own-t").value.trim());
        try {
          S.config = await api("config");
          ownerMsg = S.config.admin ? "" : "That token is not right.";
          if (!S.config.admin) local.del("ownerToken");
        } catch (x) { ownerMsg = x.message; }
        paint();
      });
      h("[data-unown]", async () => { local.del("ownerToken"); S.config = await api("config").catch(() => S.config); paint(); });
      h("[data-mode]", async (e, b) => { await api("admin/mode", { body: { mode: b.dataset.mode } }).catch((x) => snack(x.message)); S.config = await api("config"); paint(); });
      return () => offs.forEach((f) => f());
    },
  });
}

/** Saves the reports id as a small text file (or shares it), so it can be restored later. */
async function saveId() {
  const text = `Switchboard KC reports id: ${deviceId()}\nSaved ${new Date().toLocaleString()}.\nRestore it in Settings > My reports.\n`;
  const file = new File([text], "switchboard-kc-reports-id.txt", { type: "text/plain" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Switchboard KC reports id" }); return; } catch { /* fall through */ }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
