// Report sent: the report number, the city's automatic reply, and the way to
// track it. Also the moment to offer ticket alerts. Ported from DoneView.

import { bag, html, icon, render } from "../lib/html.js";
import { draftFor } from "../state.js";
import { acts } from "../ui.js";
import { alertsOffer, wireAlertsOffer } from "./alerts.js";

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
    <div id="alerts"></div>
    <button class="btn" type="button" data-act="track">${icon("assignment")}<span>Track it</span></button>
  </div>`);
  off(acts(main, {
    track: () => {
      draftFor(ctx.tab).reset();
      sessionStorage.removeItem(`done:${ctx.tab}`);
      ctx.go("/reports");
    },
  }));
  alertsOffer().then((tpl) => tpl && main.isConnected && (render(main.querySelector("#alerts"), tpl), off(wireAlertsOffer(main))));
  return off.run;
}
