// Update requests while the app is closed.
//
// The city's update form needs a way to reach the person, and this server
// keeps no contact details. So the server does not send the request. The
// person's own device does:
//
// 1. The app keeps one filled update request for each open report in the
//    device's storage, and tells the server that this device can send them
//    (the `auto` mark on its push subscription).
// 2. The cron (push.js) finds a report that is due: open, with no movement
//    and no update request for 7 days. The rule is the app's own
//    (public/js/models.js).
// 3. The server pushes an "ask" to one device of that id, with a ticket.
// 4. The device's service worker sends its stored request to /api/submit with
//    the ticket (public/sw.js). The contact details go from the device to the
//    city inside that one request, as they do when the person taps the button.
//
// The ticket takes the place of the robot check, which needs a page and a
// person. It is a signature over the id, the report and a time 15 minutes
// away. Only the device that holds the push subscription can read it, it
// works one time, and the server accepts it only for an update request that
// names that report. The server asks one time a day for each due report.

import { dueForUpdate, isUpdateRequestName, myReport, namesReport, UPDATE_TEXT } from "../public/js/models.js";
import { hmac, sameSecret } from "./util.js";

/** How long a ticket works. A device that is offline for longer gets a new ask the next day. */
export const TICKET_LIFE = 15 * 60e3;
/** The time between two asks for the same report. */
export const ASK_EVERY = 24 * 3600e3;

/** The reports in an id's `myissues` rows that are due for an update request: [{ id, caseNumber, label }]. */
export function dueReports(rows, now = Date.now()) {
  const mine = rows.map((r) => myReport(r, now));
  return mine.filter((r) => dueForUpdate(r, mine, now)).map((r) => ({ id: r.id, caseNumber: r.caseNumber, label: r.label }));
}

/** The due reports that had no ask in the past day. `asked` is { report id: time of the last ask }. */
export const toAsk = (due, asked, now = Date.now()) => due.filter((r) => now - (asked?.[r.id] || 0) >= ASK_EVERY);

/** The subscription that gets the ask: one device, so that one request goes out. The devices take turns by day. */
export function deviceFor(subs, now = Date.now()) {
  const auto = subs.filter((s) => s.auto);
  return auto.length ? auto[Math.floor(now / 86400e3) % auto.length] : null;
}

const signed = (uid, report, caseNumber, exp) => `ask|${uid}|${report}|${caseNumber || ""}|${exp}`;

export async function makeTicket(secret, uid, report, caseNumber, exp) {
  return `${exp}.${await hmac(secret, signed(uid, report, caseNumber, exp))}`;
}

/** The end time (ms) of a ticket that this server made for this id and report and that still works, else 0. */
export async function readTicket(secret, uid, report, caseNumber, ticket, now = Date.now()) {
  const m = /^(\d{13})\.([\w-]{40,50})$/.exec(String(ticket || ""));
  if (!m || !report || Number(m[1]) < now) return 0;
  return (await sameSecret(m[2], await hmac(secret, signed(uid, report, caseNumber, m[1])))) ? Number(m[1]) : 0;
}

/** True when the issue of a submit is an update request that names this report and has no photos. */
export function isAskFor(issue, report, caseNumber) {
  return !!issue && isUpdateRequestName(issue.name) && String(issue.notes || "").startsWith(UPDATE_TEXT)
    && namesReport(issue.notes, { id: report, caseNumber }) && !(issue.files_metadata || []).length;
}

/** The push message of an ask. The service worker sends the request, then shows a notification from these words. */
export function askMessage(report, ticket) {
  return {
    type: "ask", report: report.id, case: report.caseNumber || "", label: report.label, ticket,
    title: "Asked the city for an update",
    body: `${report.label} had no updates in 7 days.`,
    tag: `ask-${report.id}`,
    url: `/#/reports/mine/${report.id}`,
  };
}
