// worker/asks.js: which reports the server asks a device about, the ticket,
// and the check on the request that comes back. The rows have the shape of
// the city's `myissues` list. The values are not a real person's.

import assert from "node:assert/strict";
import test from "node:test";
import { ASK_EVERY, askMessage, deviceFor, dueReports, isAskFor, makeTicket, readTicket, TICKET_LIFE, toAsk } from "../../worker/asks.js";
import { mustLook, QUIET, statusPart } from "../../worker/push.js";

const DAY = 86400e3;
const NOW = Date.UTC(2026, 10, 12, 18, 0, 0);
const sec = (ms) => String(Math.floor(ms / 1000));
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const report = (id, filedAgo, over = {}) => ({ id, name: "Streets and Sidewalks", subcategory: "Pothole in the Street", status: "Assigned",
  description: "A deep hole.", added_on: sec(NOW - filedAgo), updated_on: utc(NOW - filedAgo), ...over });
const request = (id, ref, askedAgo) => ({ id, name: "311 Request Update", status: "new", added_on: sec(NOW - askedAgo), updated_on: utc(NOW - askedAgo),
  description: `Please send an update on ${ref}: Pothole in the Street.` });

test("a report is due when it is open with no movement and no update request for 7 days", () => {
  const rows = [
    report("9000001", 8 * DAY),                                        // due
    report("9000002", 6 * DAY),                                        // filed 6 days ago
    report("9000003", 30 * DAY, { status: "resolved" }),               // closed
    report("9000004", 30 * DAY, { updated_on: utc(NOW - 2 * DAY) }),   // staff moved it 2 days ago
    report("9000005", 30 * DAY), request("9100005", "myKCMO app report 9000005", 3 * DAY),   // asked 3 days ago
    report("9000006", 30 * DAY, { thirdparty_params: JSON.stringify({ case_number: "376006" }) }), request("9100006", "request #376006", 8 * DAY),   // asked 8 days ago: due again
    request("9100007", "myKCMO app report 9000099", 20 * DAY),         // an update request is never due itself
  ];
  assert.deepEqual(dueReports(rows, NOW), [
    { id: "9000001", caseNumber: "", label: "Pothole in the Street" },
    { id: "9000006", caseNumber: "376006", label: "Pothole in the Street" },
  ]);
  assert.deepEqual(dueReports([], NOW), []);
});

test("one ask a day for a report", () => {
  const due = [{ id: "1" }, { id: "2" }, { id: "3" }];
  assert.deepEqual(toAsk(due, { 1: NOW - ASK_EVERY + 1, 2: NOW - ASK_EVERY }, NOW).map((r) => r.id), ["2", "3"]);
  assert.deepEqual(toAsk(due, undefined, NOW).length, 3);
});

test("the ask goes to one device that sends update requests, and the devices take turns by day", () => {
  const subs = [{ endpoint: "a", auto: false }, { endpoint: "b", auto: true }, { endpoint: "c", auto: true }];
  assert.equal(deviceFor([{ endpoint: "a", auto: false }], NOW), null);
  assert.equal(deviceFor([], NOW), null);
  const today = deviceFor(subs, NOW).endpoint, next = deviceFor(subs, NOW + DAY).endpoint;
  assert.deepEqual([today, next].sort(), ["b", "c"]);
  assert.equal(deviceFor(subs, NOW + 2 * DAY).endpoint, today);
});

test("a ticket is good for its id, its report and its time only", async () => {
  const uid = "0123456789abcdef", exp = NOW + TICKET_LIFE;
  const t = await makeTicket("secret", uid, "9000001", "376006", exp);
  assert.match(t, /^\d{13}\.[\w-]{43}$/);
  assert.equal(await readTicket("secret", uid, "9000001", "376006", t, NOW), exp);
  assert.equal(await readTicket("secret", uid, "9000001", "376006", t, exp + 1), 0, "past its time");
  assert.equal(await readTicket("secret", uid, "9000002", "376006", t, NOW), 0, "another report");
  assert.equal(await readTicket("secret", uid, "9000001", "376007", t, NOW), 0, "another case number");
  assert.equal(await readTicket("secret", "fedcba9876543210", "9000001", "376006", t, NOW), 0, "another id");
  assert.equal(await readTicket("other", uid, "9000001", "376006", t, NOW), 0, "another server key");
  // A later time on the same signature does not work.
  assert.equal(await readTicket("secret", uid, "9000001", "376006", `${exp + 60000}.${t.split(".")[1]}`, NOW), 0);
  for (const bad of ["", null, "x", `${exp}.`, `${exp}.short`]) assert.equal(await readTicket("secret", uid, "9000001", "376006", bad, NOW), 0);
  assert.equal(await readTicket("secret", uid, "", "", await makeTicket("secret", uid, "", "", exp), NOW), 0, "no report");
});

test("a ticket opens the door for an update request about its report, and for nothing else", () => {
  const ask = { name: "311 Request Update", notes: "Please send an update on myKCMO app report 9000001: Pothole in the Street at 1 Test St.", files_metadata: [] };
  assert.ok(isAskFor(ask, "9000001", ""));
  assert.ok(isAskFor({ ...ask, notes: "Please send an update on request #376006: Pothole." }, "9000001", "376006"));
  assert.ok(!isAskFor(ask, "9000002", ""), "another report");
  assert.ok(!isAskFor(ask, "900000", ""), "a shorter number is another report");
  assert.ok(!isAskFor({ ...ask, name: "Streets and Sidewalks" }, "9000001", ""), "a report of another type");
  assert.ok(!isAskFor({ ...ask, notes: "There is a pothole. myKCMO app report 9000001" }, "9000001", ""), "not the update text");
  assert.ok(!isAskFor({ ...ask, files_metadata: [{ filename: "CAM1.jpeg" }] }, "9000001", ""), "photos");
  assert.ok(!isAskFor(null, "9000001", ""));
});

test("the ask message has what the service worker needs, and no contact data", () => {
  const m = askMessage({ id: "9000001", caseNumber: "376006", label: "Pothole in the Street" }, "T");
  assert.deepEqual(m, { type: "ask", report: "9000001", case: "376006", label: "Pothole in the Street", ticket: "T",
    title: "Asked the city for an update", body: "Pothole in the Street had no updates in 7 days.", tag: "ask-9000001", url: "/#/reports/mine/9000001" });
});

test("a report whose update time moves each minute gets one look at its timeline in QUIET minutes", () => {
  const sig = (status, time) => `9000001:${status}|${time}`;
  assert.equal(statusPart("9000001:Assigned|2026-11-10 13:02:11,9100001:new|2026-11-10 13:00:00"), "9000001:Assigned,9100001:new");
  const m = 29_700_000;
  assert.equal(mustLook(undefined, sig("Assigned", "a"), m), true, "first look");
  const prior = { sig: sig("Assigned", "a"), keys: [], at: m };
  assert.equal(mustLook(prior, sig("Assigned", "a"), m + 1), false, "no change");
  assert.equal(mustLook(prior, sig("Assigned", "b"), m + 1), false, "only the update time moved, 1 minute after the last look");
  assert.equal(mustLook(prior, sig("Assigned", "b"), m + QUIET - 1), false);
  assert.equal(mustLook(prior, sig("Assigned", "b"), m + QUIET), true, "QUIET minutes after the last look");
  assert.equal(mustLook(prior, sig("Resolved", "b"), m + 1), true, "a status change is read at once");
  // A new update request for the report changes the status part too.
  assert.equal(mustLook(prior, `${sig("Assigned", "a")},9100001:new|c`, m + 1), true);
  // A row saved before the look time was kept (at 0) is read.
  assert.equal(mustLook({ sig: sig("Assigned", "a"), keys: [] }, sig("Assigned", "b"), m), true);
  // The day of 2026-11-10: 835 minutes with a new update time and one status. Before: 835 looks.
  let looks = 0, seen = { sig: sig("Assigned", 0), keys: [], at: m };
  for (let i = 1; i <= 835; i++) if (mustLook(seen, sig("Assigned", i), m + i)) { looks++; seen = { sig: sig("Assigned", i), keys: [], at: m + i }; }
  assert.equal(looks, Math.floor(835 / QUIET));
});
