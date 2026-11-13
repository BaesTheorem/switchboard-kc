// worker/rating.js against the city's Android app (FeedbackNoteFragment and
// MyReportRowViewHolder, read 2026-11-12) and a `myissues` row read that day.

import assert from "node:assert/strict";
import { test } from "node:test";
import { isClosedForRating, notRated, ratingBlock, ratingDetails, STARS } from "../../worker/rating.js";

// The fields of a live row that the rating reads. The values are not a real report's.
const row = (over = {}) => ({ id: "1000001", city_report_id: "1000001", status: "Resolved", hasRated: "no", ratingValue: 0, ratingID: 0, ...over });

test("five stars with the values 1 to 5: the city's app refuses 0", () => {
  assert.deepEqual(STARS, [1, 2, 3, 4, 5]);
});

test("a rating is for a resolved or closed report only", () => {
  for (const s of ["Resolved", "resolved", " RESOLVED ", "close", "Closed"]) assert.ok(isClosedForRating(s), s);
  for (const s of ["canceled", "Assigned", "received", "new", "", null, undefined, "unresolved"]) assert.ok(!isClosedForRating(s), String(s));
});

test("a row is not rated only when the city says no", () => {
  assert.ok(notRated(row()));
  assert.ok(notRated(row({ hasRated: "NO" })));
  assert.ok(!notRated(row({ hasRated: "yes" })));
  // A list with no such field: the app does not offer a rating that the city can refuse.
  assert.ok(!notRated({ id: "1", status: "resolved" }));
});

test("ratingBlock names the reason", () => {
  assert.equal(ratingBlock(row()), "");
  assert.equal(ratingBlock(undefined), "not_yours");
  assert.equal(ratingBlock(row({ status: "Assigned" })), "not_closed");
  assert.equal(ratingBlock(row({ status: "canceled" })), "not_closed");
  assert.equal(ratingBlock(row({ hasRated: "yes", ratingValue: 4 })), "rated");
});

test("rating_details: the app's keys in the app's order, the star as a string, no contact keys", () => {
  const d = ratingDetails("c".repeat(32), "6.0", "0123456789abcdef", row({ city_report_id: "1000002" }), 5, "Thank you");
  assert.deepEqual(Object.keys(d), ["city_id", "device_id", "deviceuid", "rating", "report_id", "notes", "api_version"]);
  assert.equal(d.rating, "5");
  assert.equal(d.report_id, "1000002");
  assert.equal(d.device_id, d.deviceuid);
  assert.equal(d.notes, "Thank you");
  assert.equal(d.api_version, "6.0");
  for (const k of ["first_name", "last_name", "email_address", "phone_number"]) assert.ok(!(k in d), k);
});

test("rating_details: an empty comment is an empty string, and a row with no city_report_id uses its id", () => {
  const d = ratingDetails("c", "6.0", "0123456789abcdef", { id: "7" }, 1, undefined);
  assert.equal(d.notes, "");
  assert.equal(d.report_id, "7");
  assert.equal(d.rating, "1");
});
