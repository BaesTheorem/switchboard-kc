// The invite screen. A server in invite mode forwards city calls only for
// people with an invite code (worker/auth.js). A code arrives as a link
// (#invite=CODE) or is typed here; the server trades it for a session token,
// which this device keeps.

import { api } from "../api.js";
import { html, icon, render } from "../lib/html.js";
import { local } from "../lib/store.js";

let open = null;

export function showInviteGate(code) {
  if (open) return open;
  open = new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "picker";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "inv-h");
    render(el, html`<div class="screen stack s20" style="padding-top:calc(48px + var(--safe-top));overflow:auto">
      <img src="/icons/icon-192.png" alt="" width="72" height="72" style="border-radius:16px">
      <h1 class="title2" id="inv-h">Join this KC 311 server</h1>
      <p class="sub muted">This server sends reports to the city for invited people only. Enter the invite code you got, or open your invite link.</p>
      <form class="stack s12" id="inv-f">
        <label class="field-label" for="inv-code">Invite code</label>
        <input class="input code" id="inv-code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" placeholder="abcd-efgh-jkmn-pqrs" value="${code || ""}">
        <p class="foot error-text" id="inv-err" role="alert"></p>
        <button class="btn" type="submit" id="inv-go">${icon("login")}<span>Join</span></button>
      </form>
      <div class="card stack s8">
        <p class="sub strong">No invite?</p>
        <p class="foot muted">Call 311 at 816-513-1313, or use the city's own myKCMO app. Anyone can also run their own copy of this app for free: the source code and steps are on GitHub.</p>
        <a class="link" href="https://github.com/BaesTheorem/kc311#run-your-own-web-server" target="_blank" rel="noopener">How to run your own</a>
      </div>
      <details class="card">
        <summary class="sub strong" style="cursor:pointer;min-height:44px;display:flex;align-items:center">I run this server</summary>
        <form class="stack s8" id="own-f">
          <label class="caption muted" for="own-token">Owner token (ADMIN_TOKEN)</label>
          <input class="input code" id="own-token" type="password" autocomplete="current-password" spellcheck="false">
          <p class="foot error-text" id="own-err" role="alert"></p>
          <button class="btn tonal" type="submit">Open as the owner</button>
        </form>
      </details>
      <p class="foot muted">For an emergency, call 911.</p>
    </div>`);
    document.body.append(el);
    // The app behind the screen is out of reach (focus, screen readers) until it closes.
    for (const id of ["appbar", "view", "tabs"]) document.getElementById(id)?.setAttribute("inert", "");
    const input = el.querySelector("#inv-code");
    const err = el.querySelector("#inv-err");
    const go = async (e) => {
      e?.preventDefault();
      err.textContent = "";
      const b = el.querySelector("#inv-go");
      b.disabled = true;
      try {
        const o = await api("session", { body: { code: input.value } });
        local.set("session", o.token);
        // Start fresh with the session: the launch work runs again.
        location.replace("/#/report");
        location.reload();
        resolve(true);
      } catch (x) {
        err.textContent = x.message;
        b.disabled = false;
        input.focus();
      }
    };
    el.querySelector("#inv-f").addEventListener("submit", go);
    // The owner gets in with the server's token, then makes invites in Settings > Owner tools.
    el.querySelector("#own-f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = el.querySelector("#own-token").value.trim();
      local.set("ownerToken", token);
      const r = await fetch("/api/config", { headers: { "x-admin-token": token } }).then((x) => x.json()).catch(() => null);
      if (r?.admin) { location.replace("/#/report"); location.reload(); return; }
      local.del("ownerToken");
      el.querySelector("#own-err").textContent = "That token is not right.";
    });
    if (code) go();
    else input.focus();
  });
  return open;
}
