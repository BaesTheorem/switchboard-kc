// The Police report screen. The police department is not part of 311, so the
// app sends the person there: 911 and the non-emergency number first, the
// department's conditions for an online report, its report types (each one
// opens the department's own form), and the way to a copy of a report. The
// app files nothing here. The facts are in ../police.js, with their source.

import { bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { NON_EMERGENCY, POLICE_PAGE, POLICE_READ, POLICE_RULES, POLICE_TYPES, policeFormUrl, RECORDS, STATIONS_PAGE } from "../police.js";

const tel = (n) => `tel:${n.replace(/\D/g, "")}`;

export default function police(main, _params, ctx) {
  ctx.title("Police report");
  const off = bag();
  let spanish = false;

  const out = (href, title, note = "", lead = "") => html`<a class="item" href="${safeUrl(href)}" target="_blank" rel="noopener">
    ${lead ? icon(lead) : ""}<span class="grow stack s4" style="gap:2px"><span class="sub">${title}</span>${note ? html`<span class="caption muted">${note}</span>` : ""}</span>
    ${icon("open_in_new", "trail")}</a>`;

  const paint = () => render(main, html`
    <div class="screen stack s24 police">
      <div class="row">
        <div class="avatar">${icon("local_police")}</div>
        <div class="grow">
          <div class="headline">Police report</div>
          <div class="sub muted">Not part of 311. This goes to the Kansas City Police Department.</div>
        </div>
      </div>

      <section class="hero stack s12" aria-labelledby="pd-now">
        <h2 class="title2" id="pd-now">An emergency, or a crime in progress</h2>
        <a class="btn" href="tel:911">${icon("emergency")}<span>Call 911</span></a>
        <p class="sub muted">Not an emergency, but you need an officer, or you are not sure where your report goes:</p>
        <a class="btn soft" href="${tel(NON_EMERGENCY)}">${icon("call")}<span>Call ${NON_EMERGENCY}</span></a>
      </section>

      <section class="stack s8" aria-labelledby="pd-rules">
        <h2 class="label" id="pd-rules">Report online when all of these are true</h2>
        <div class="card stack s8">
          ${POLICE_RULES.map((r) => html`<div class="row top">${icon("check", "primary-text")}<p class="sub grow">${r}</p></div>`)}
        </div>
        <p class="caption muted">If one is not true, call ${NON_EMERGENCY} or go to a
          <a class="primary-text" href="${safeUrl(STATIONS_PAGE)}" target="_blank" rel="noopener">patrol station</a>.</p>
      </section>

      <section class="stack s8" aria-labelledby="pd-types">
        <div class="row">
          <h2 class="label grow" id="pd-types">Choose a report</h2>
          <div class="seg" role="group" aria-label="Language of the form">
            <button type="button" data-lang="en" aria-pressed="${String(!spanish)}">English</button>
            <button type="button" data-lang="es" aria-pressed="${String(spanish)}" lang="es">Español</button>
          </div>
        </div>
        <div class="rows" id="pd-list">
          ${POLICE_TYPES.map((t) => out(policeFormUrl(t, spanish), t.name, t.suspect ? "Accepted when you know who did it" : ""))}
        </div>
        <p class="caption muted">Each one opens the police department's own form. You have 30 minutes for each screen. You can add photos, but not video. At the end you get a tracking number and a temporary copy to print. The department reads each report and can contact you. A false police report is a crime.</p>
      </section>

      <section class="stack s8" aria-labelledby="pd-copy">
        <h2 class="label" id="pd-copy">Get a copy of a report</h2>
        <div class="rows">
          ${out(`${RECORDS.request}${spanish ? "es" : ""}`, "Request a report online", "The department says 12 to 16 weeks", "description")}
          ${out(RECORDS.crash, "Traffic crash reports", "", "directions_car")}
          <a class="item" href="${tel(RECORDS.phone)}">${icon("call")}<span class="grow stack s4" style="gap:2px"><span class="sub">Call Criminal Records: ${RECORDS.phone}</span>
            <span class="caption muted">${RECORDS.hours} Ask if your report is ready, or for your case report number.</span></span></a>
          ${out(RECORDS.fees, "Fees for records", "", "payments")}
        </div>
        <div class="card stack s8">
          <p class="sub">A report opens to the public 20 business days after the incident.</p>
          <p class="sub"><span class="strong">In person:</span> any patrol station, with photo identification. Call first to make sure that the report is ready.</p>
          <p class="sub"><span class="strong">By mail:</span> ${RECORDS.mail.join(", ")}. Make the check payable to "Board of Police Commissioners", and put in a stamped envelope with your address. The department says 24 weeks.</p>
        </div>
      </section>

      <p class="caption muted">From the police department's pages, read ${POLICE_READ}.
        <a class="primary-text" href="${safeUrl(POLICE_PAGE)}" target="_blank" rel="noopener">See the department's page</a> for the list as it is now. Switchboard KC is not part of the police department.</p>
    </div>`);

  paint();
  off(on(main, "click", "[data-lang]", (e, b) => { spanish = b.dataset.lang === "es"; paint(); }));
  return off.run;
}
