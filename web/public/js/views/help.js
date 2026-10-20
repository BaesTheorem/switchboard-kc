// Health and help: crisis lines first, then the basic-needs screens, then one
// card per top cause area in Kansas City Effective Altruism's cause
// prioritization, each with the intervention a resident can use and who
// delivers it here. Every number and link was checked against the provider's
// own page on 2026-10-06. Ported from HealthHelp.swift.

import { bag, html, icon, on, render, safeUrl } from "../lib/html.js";
import { label } from "../ui.js";

const CRISIS = [
  { id: "988", title: "988 Suicide & Crisis Lifeline", icon: "support_agent",
    what: "Call or text any time for emotional support or a mental health crisis.",
    who: "National lifeline", phone: { label: "Call 988", number: "988" }, text: { label: "Text 988", number: "988" },
    link: { label: "988lifeline.org", url: "https://988lifeline.org" } },
  { id: "211", title: "211: food, shelter, utilities, rent", icon: "diversity_1",
    what: "One call to find food pantries, shelters, utility and rent help, and more. Open 24/7, with interpreters.",
    who: "United Way of Greater Kansas City", phone: { label: "Call 211", number: "211" },
    link: { label: "Search the 211 database", url: "https://www.unitedwaygkc.org/211" },
    note: "From a phone that cannot dial 211: 816-474-5112." },
  { id: "firstcall", title: "Addiction crisis line", icon: "call",
    what: "Free 24/7 help for you or someone you love with alcohol or drug use.",
    who: "First Call", phone: { label: "Call 816-361-5900", number: "8163615900" },
    link: { label: "firstcallkc.org", url: "https://www.firstcallkc.org" } },
];

/** In the order of the cause prioritization. `report` names a 311 report that helps; it opens Services. */
const CAUSES = [
  { id: "tobacco", title: "Quit smoking, vaping, or chew", icon: "smoke_free",
    what: "Free quit coaching by phone, text, or online, any time. Coaches build a quit plan with you.",
    who: "Missouri Tobacco Quit Services", phone: { label: "Call 1-800-QUIT-NOW", number: "18007848669" },
    link: { label: "youcanquit.org", url: "https://youcanquit.org" },
    note: "Teens: mylifemyquit.org." },
  { id: "overdose", title: "Prevent an overdose", icon: "medication",
    what: "Free naloxone (Narcan) and fentanyl test strips, and training on how to use them. Both are legal in Missouri.",
    who: "First Call", phone: { label: "Call 816-361-5900", number: "8163615900" },
    link: { label: "Request naloxone", url: "https://www.firstcallkc.org/harmreduction/" } },
  { id: "falls", title: "Prevent falls (older adults)", icon: "elderly",
    what: "A Matter of Balance: a free 8-class program on strength, balance, and making a home safer.",
    who: "Shepherd's Center of KC Central", phone: { label: "Call (816) 444-1121", number: "8164441121" },
    link: { label: "Class schedule", url: "https://kcshepherdscenter.org/programs-and-services/a-matter-of-balance.html" },
    note: "Registration is free. Space is limited.",
    report: "Report a broken sidewalk" },
  { id: "bp", title: "Check your blood pressure", icon: "monitor_heart",
    what: "High blood pressure is Kansas City's single largest health burden. Primary care for all ages, with a sliding fee for insured or uninsured patients.",
    who: "Samuel U. Rodgers Health Center", phone: { label: "Call (816) 474-4920", number: "8164744920" },
    link: { label: "samrodgers.org", url: "https://samrodgers.org/medical-services/" } },
  { id: "traffic", title: "Safer streets", icon: "traffic",
    what: "Report a dangerous intersection, speeding, a missing crosswalk, or a signal problem.",
    who: "City of Kansas City, through 311",
    report: "Request traffic calming" },
  { id: "infant", title: "New and expecting moms", icon: "pregnancy",
    what: "Nurse-Family Partnership: free visits from a nurse during pregnancy and the baby's first two years, for first-time moms.",
    who: "Nurse-Family Partnership (Changent)",
    link: { label: "Check if you qualify", url: "https://changent.org/for-families/" },
    note: "Availability in Kansas City is not confirmed yet." },
  { id: "locks", title: "Free gun locks", icon: "lock",
    what: "A cable lock keeps a gun out of reach of children and of anyone in crisis.",
    who: "Project ChildSafe and local police",
    link: { label: "Find a free safety kit", url: "https://projectchildsafe.org/get-a-safety-kit/" },
    note: "KCPD has offered free locks at patrol stations. Call 816-234-5000 first to confirm." },
];

/** The basic-needs screens (views/places.js), by route kind. */
const NEEDS = [
  { kind: "stay", title: "Somewhere to stay", sub: "Shelters, cooling and warming centers", icon: "night_shelter" },
  { kind: "food", title: "Food", sub: "Food pantries, meals, stores that take SNAP", icon: "restaurant" },
  { kind: "clinics", title: "Low-cost clinics", sub: "Health centers with fees based on income", icon: "local_hospital" },
  { kind: "benefits", title: "SNAP, Medicaid, housing help", sub: "Benefits offices, rent and eviction help", icon: "home_work" },
];

const RANKING = "https://becomingstronger.github.io/kc-cause-prioritization.html";

/**
 * In-app links carry `data-go` with their route. A plain click goes through
 * the router, so the Back button returns here. A click with a modifier key
 * opens a new tab as usual. Returns the remover.
 */
export function follow(root, go) {
  return on(root, "click", "a[data-go]", (e, a) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(a.dataset.go);
  });
}

/**
 * The red "Health and help" card shown on the Report and City tabs. `href` is
 * the route ("#/report/help" or "/report/help"). Wire the page with follow().
 */
export function helpCard(href) {
  const to = String(href).replace(/^#/, "");
  return html`<a class="plain help-card" href="${safeUrl(`#${to}`)}" data-go="${to}">
    <span class="tile help row top">
      ${icon("favorite")}
      <span class="grow stack s4">
        <span class="headline">Health and help</span>
        <span class="caption muted">Crisis lines, food and shelter, quitting tobacco, overdose prevention, falls, and more.</span>
      </span>
      ${icon("chevron_right")}
    </span>
  </a>`;
}

function card(r) {
  return html`<div class="card stack s8">
    <div class="row base s8">${icon(r.icon, "error-text")}<h3 class="headline grow">${r.title}</h3></div>
    <p class="sub">${r.what}</p>
    <p class="caption strong muted">${r.who}</p>
    ${r.note ? html`<p class="caption muted">${r.note}</p>` : ""}
    <div class="chips">
      ${r.phone ? html`<a class="chip-s filled-error tap" href="${safeUrl(`tel:${r.phone.number}`)}">${icon("call")}<span>${r.phone.label}</span></a>` : ""}
      ${r.text ? html`<a class="chip-s help-chip tap" href="${safeUrl(`sms:${r.text.number}`)}">${icon("sms")}<span>${r.text.label}</span></a>` : ""}
      ${r.link ? html`<a class="chip-s help-chip tap" href="${safeUrl(r.link.url)}" target="_blank" rel="noopener">${icon("open_in_new")}<span>${r.link.label}</span></a>` : ""}
      ${r.report ? html`<a class="chip-s help-chip tap" href="#/services" data-go="/services">${icon("report")}<span>${r.report}</span></a>` : ""}
    </div>
  </div>`;
}

export default function helpView(main, _params, ctx) {
  const base = `/${ctx.tab}/help`;
  render(main, html`<div class="screen city-ui stack">
    <a class="plain" href="tel:911">
      <span class="tile help row">${icon("emergency")}<span class="headline grow">In danger right now? Call 911.</span></span>
    </a>
    ${label("Help now")}
    ${CRISIS.map(card)}
    ${label("Basic needs")}
    <div class="rows">
      ${NEEDS.map((n) => html`<a class="item need" href="${safeUrl(`#${base}/${n.kind}`)}" data-go="${base}/${n.kind}">
        ${icon(n.icon)}
        <span class="grow stack s4"><span class="sub strong">${n.title}</span><span class="caption muted">${n.sub}</span></span>
        ${icon("chevron_right", "trail")}
      </a>`)}
    </div>
    ${label("Prevent the most harm")}
    <p class="caption muted">Ordered by Kansas City Effective Altruism's ranking of where effort saves the most healthy years of life here.</p>
    ${CAUSES.map(card)}
    <p><a class="link" href="${safeUrl(RANKING)}" target="_blank" rel="noopener">How the causes were ranked</a></p>
  </div>`);
  const add = bag();
  add(follow(main, ctx.go));
  return add.run;
}
