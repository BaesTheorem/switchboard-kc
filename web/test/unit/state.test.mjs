// state.js update-request rules against ios/KC311/Sources/AutoUpdates.swift:
// a request opens 7 days after filing and 7 days after the last request, and
// a report is due when it is open with no movement and no request for 7 days.
// The texts follow Store.tooSoon (relative time, then the abbreviated date).
// Times are mid-day UTC, so the dates are the same in every US time zone.

import assert from "node:assert/strict";
import test from "node:test";
import { myReport } from "../../public/js/models.js";
import { isDue, reference, S, tooSoon } from "../../public/js/state.js";

const DAY = 86400e3;
const WEEK = 7 * DAY;
const NOW = Date.UTC(2026, 9, 20, 17, 0, 0);
const sec = (ms) => String(ms / 1000);
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** A row of "my reports", filed `filedAgo` ms before NOW, with its last movement `movedAgo` ms before NOW. */
function report(id, { filedAgo, movedAgo, status = "received", caseNumber = "" }) {
  const row = { id, name: "A Pothole", subcategory: "Pothole in the Street", status, description: "Deep hole.",
    address: "4131 E Truman Rd", added_on: sec(NOW - filedAgo) };
  if (movedAgo != null) row.updated_on = utc(NOW - movedAgo);
  if (caseNumber) row.thirdparty_params = JSON.stringify({ case_number: caseNumber });
  return myReport(row, NOW);
}

/** An update request this app filed `askedAgo` ms before NOW. The city files it as "Administration or Questions". */
function updateRequest(id, ref, askedAgo) {
  return myReport({ id, name: "Administration or Questions", status: "new", added_on: sec(NOW - askedAgo),
    description: `Please send an update on ${ref}: Pothole in the Street at 4131 E Truman Rd.` }, NOW);
}

test("reference names a report by its case number, else by its MyCivic id", () => {
  assert.equal(reference({ id: "abc123", caseNumber: "376006" }), "request #376006");
  assert.equal(reference({ id: "abc123", caseNumber: "" }), "myKCMO app report abc123");
});

test("tooSoon: no update request in the 7 days after filing", () => {
  S.myReports = [];
  const r = report("r1", { filedAgo: 2 * DAY });
  assert.equal(tooSoon(r, NOW), "Filed 2 days ago. Update requests open Oct 25, 2026.");
  assert.equal(tooSoon(report("r1b", { filedAgo: WEEK }), NOW), null, "exactly 7 days is open");
});

test("tooSoon: no update request in the 7 days after the last one", () => {
  const r = report("r2", { filedAgo: 20 * DAY, caseNumber: "376006" });
  S.myReports = [r, updateRequest("u1", "request #376006", 3 * DAY)];
  assert.equal(tooSoon(r, NOW), "Update asked 3 days ago. The next one opens Oct 24, 2026.");
  S.myReports = [r, updateRequest("u2", "request #376006", 8 * DAY)];
  assert.equal(tooSoon(r, NOW), null);
  // A request about another case does not count.
  S.myReports = [r, updateRequest("u3", "request #376007", 1 * DAY)];
  assert.equal(tooSoon(r, NOW), null);
});

test("tooSoon: a report without a case number is matched by its MyCivic id", () => {
  const r = report("9f8e7d", { filedAgo: 20 * DAY });
  S.myReports = [r, updateRequest("u4", "myKCMO app report 9f8e7d", 1 * DAY)];
  assert.equal(tooSoon(r, NOW), "Update asked yesterday. The next one opens Oct 26, 2026.");
});

test("isDue: open, and no movement for 7 days", () => {
  S.myReports = [];
  assert.equal(isDue(report("d1", { filedAgo: 10 * DAY, movedAgo: 8 * DAY }), NOW), true);
  assert.equal(isDue(report("d2", { filedAgo: 10 * DAY, movedAgo: 6 * DAY }), NOW), false);
  assert.equal(isDue(report("d3", { filedAgo: 10 * DAY, movedAgo: WEEK }), NOW), true, "exactly 7 days");
  assert.equal(isDue(report("d4", { filedAgo: 10 * DAY, movedAgo: WEEK - 1000 }), NOW), false);
  assert.equal(isDue(report("d5", { filedAgo: 3 * DAY }), NOW), false, "filing counts as movement");
  assert.equal(isDue(report("d6", { filedAgo: 30 * DAY, status: "resolved" }), NOW), false, "closed");
});

test("isDue: an update request in the last 7 days holds the next one back", () => {
  const r = report("d7", { filedAgo: 30 * DAY, movedAgo: 20 * DAY });
  S.myReports = [r, updateRequest("u5", "myKCMO app report d7", 3 * DAY)];
  assert.equal(isDue(r, NOW), false);
  S.myReports = [r, updateRequest("u6", "myKCMO app report d7", 9 * DAY)];
  assert.equal(isDue(r, NOW), true);
  assert.equal(isDue(S.myReports[1], NOW), false, "an update request is never due itself");
});
