// Report sent: the report number, the city's automatic reply, and the way to
// track it. Also the moment to offer ticket alerts, the Home Screen app and
// a passkey copy of the reports id. Ported from DoneView.

import { bag, html, icon, render } from "../lib/html.js";
import { draftFor } from "../state.js";
import { acts } from "../ui.js";
import { installCard, installed, wireInstallCard } from "../install.js";
import { alertsOffer, alertState, wireAlertsOffer } from "./alerts.js";
import { keepCard, wireKeep } from "./keep.js";

export default function view(main, _params, ctx) {
  const off = bag();
  const info = JSON.parse(sessionStorage.getItem(`done:${ctx.tab}`) || "{}");
  if (info.queued) ctx.title("Saved to send");
  render(main, html`<div class="screen stack s20 centered" style="padding-top:32px">
    <i class="fill done-text" style="--_size:72px" aria-hidden="true">${info.queued ? "cloud_upload" : "check_circle"}</i>
    <h2 class="title2">${info.queued ? "Saved. It goes out when the city's server answers." : "Report sent"}</h2>
    ${info.wo ? html`<p class="title3 muted mono" style="user-select:text">Report #${info.wo}</p>
      <p class="caption muted">Some report types also get a separate city case number, which shows in your reports when it is assigned.</p>` : ""}
    ${info.note ? html`<p class="card sub muted prewrap" style="text-align:left">${info.note}</p>` : ""}
    <button class="btn" type="button" data-act="track">${icon("assignment")}<span>Track it</span></button>
    <div id="alerts"></div>
    <div id="keep" class="stack s12"></div>
  </div>`);
  off(acts(main, {
    track: () => {
      draftFor(ctx.tab).reset();
      sessionStorage.removeItem(`done:${ctx.tab}`);
      ctx.go("/reports");
    },
  }));
  // On iPhone the alerts offer is the install card itself, so the install card is not drawn twice.
  const paintKeep = async () => {
    if (!main.isConnected) return;
    const iosAlerts = !installed() && (await alertState()) === "needs-install";
    render(main.querySelector("#keep"), html`${iosAlerts ? "" : installCard()}${keepCard()}`);
  };
  const paintAlerts = () => alertsOffer().then((tpl) => main.isConnected && render(main.querySelector("#alerts"), tpl || ""));
  off(wireAlertsOffer(main), wireKeep(main, paintKeep), wireInstallCard(main, () => { paintAlerts(); paintKeep(); }));
  paintAlerts();
  paintKeep();
  return off.run;
}
