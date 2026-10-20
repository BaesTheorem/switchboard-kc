// views/streetcar.js against ios/KC311/Sources/Streetcar.swift: the report
// types, the stops, and the exact texts of the two channels.

import assert from "node:assert/strict";
import test from "node:test";
import {
  appleTouch, CARS, DEFAULT_KIND, KINDS, mailBody, mailSubject, mailtoHref, nearestStop, smsBody, smsHref, STOPS, whereText,
} from "../../public/js/views/streetcar.js";

const AT_STOP = { kind: { name: "Graffiti", dispatch: true }, details: "  Tag on the shelter glass.\n", onboard: false, car: "NA", stop: "Library (9th & Main)" };

test("report types, stops, and cars match the Streetcar enum", () => {
  assert.deepEqual(KINDS.map((g) => [g.group, g.kinds.length]), [["Safety / Security", 8], ["Maintenance", 5], ["Service", 4]]);
  assert.ok(KINDS[0].kinds.every((k) => k.dispatch) && KINDS[1].kinds.every((k) => k.dispatch));
  assert.ok(KINDS[2].kinds.every((k) => !k.dispatch), "service problems go to email first");
  assert.deepEqual(KINDS[2].kinds.map((k) => k.name), ["Arrival sign / tracker wrong", "Service delay or gap", "Accessibility problem", "Comment / Other Issue"]);
  assert.equal(DEFAULT_KIND.name, "Cleanliness / Trash");
  assert.equal(STOPS.length, 19);
  assert.equal(STOPS[0][0], "Riverfront (Berkley Riverfront)");
  assert.equal(STOPS[18][0], "UMKC (51st & Brookside)");
  assert.deepEqual(CARS, ["801", "802", "803", "804", "805", "806", "807", "808", "809", "810", "811", "812", "813", "814"]);
});

test("nearestStop picks the closest stop", () => {
  assert.equal(nearestStop({ lat: 39.0847, lng: -94.5841 })[0], "Union Station (Pershing & Main)");
  assert.equal(nearestStop({ lat: 39.0, lng: -94.6 })[0], "UMKC (51st & Brookside)");
  const [name, m] = nearestStop({ lat: 39.10311, lng: -94.58307 });
  assert.equal(name, "Library (9th & Main)");
  assert.ok(m < 1);
});

test("whereText at a stop and on board", () => {
  assert.equal(whereText(AT_STOP), "at the Library (9th & Main) stop");
  assert.equal(whereText({ onboard: true, car: "NA", stop: "Library (9th & Main)" }),
    "on board streetcar (number not seen), near the Library (9th & Main) stop");
  assert.equal(whereText({ onboard: true, car: "805", stop: "" }), "on board streetcar 805");
});

test("the See Say text", () => {
  assert.equal(smsBody(AT_STOP, null), "Graffiti: Tag on the shelter glass. Location: at the Library (9th & Main) stop.");
  assert.equal(smsBody(AT_STOP, { lat: 39.10311, lng: -94.58307 }),
    "Graffiti: Tag on the shelter glass. Location: at the Library (9th & Main) stop. GPS 39.103110, -94.583070.");
});

test("the email subject", () => {
  const st = { kind: { name: "Service delay or gap" }, onboard: false, car: "NA", stop: "Westport (39th & Main)" };
  assert.equal(mailSubject(st), "[Issue Report] Service delay or gap - Westport (39th & Main)");
  assert.equal(mailSubject({ ...st, onboard: true, car: "807" }), "[Issue Report] Service delay or gap - Streetcar 807");
  assert.equal(mailSubject({ ...st, onboard: true }), "[Issue Report] Service delay or gap - Streetcar NA");
});

test("the email body", () => {
  const st = { kind: { name: "Arrival sign / tracker wrong" }, details: "The sign shows no times. ", onboard: false, car: "NA", stop: "Westport (39th & Main)" };
  const place = { lat: 39.05643, lng: -94.58612, source: "phone GPS", address: "", street: "", crossStreet: "", intersection: "" };
  const when = new Date(2026, 9, 20, 15, 4);
  const lines = mailBody(st, { place, photos: 1, contact: { firstName: "Pat", lastName: "Doe", phone: "816-555-0100", email: "pat@example.com" }, when }).split("\n");
  assert.match(lines[2], /^I want to report a problem I saw on Tuesday, October 20, 2026 at 3:04\sPM\.$/);
  lines[2] = "DATE";
  assert.deepEqual(lines, ["Hello,", "", "DATE", "", "The sign shows no times.", "", "Location: at the Westport (39th & Main) stop.",
    "GPS 39.056430, -94.586120 (phone GPS).", "", "A photo is attached.", "", "Please let me know if you need more details.",
    "", "Thank you,", "Pat Doe", "816-555-0100", "pat@example.com"]);

  // No place, no photo, no saved contact.
  const plain = mailBody(st, { when, contact: { firstName: "", lastName: "", email: "", phone: "" } }).split("\n");
  plain[2] = "DATE";
  assert.deepEqual(plain, ["Hello,", "", "DATE", "", "The sign shows no times.", "", "Location: at the Westport (39th & Main) stop.",
    "", "Please let me know if you need more details."]);
});

test("the sms: and mailto: links encode every part", () => {
  assert.equal(smsHref("A & B? #1\nok", true), "sms:8168374800&body=A%20%26%20B%3F%20%231%0Aok");
  assert.equal(smsHref("hi", false), "sms:8168374800?body=hi");
  assert.equal(mailtoHref("[Issue Report] Graffiti - Power & Light (14th & Main)", "Line 1\nLine 2"),
    "mailto:info@kcstreetcar.org?subject=%5BIssue%20Report%5D%20Graffiti%20-%20Power%20%26%20Light%20(14th%20%26%20Main)&body=Line%201%0ALine%202");
});

test("appleTouch: iPhone and iPad yes, a Mac or Android no", () => {
  assert.equal(appleTouch({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5 }, null), true);
  assert.equal(appleTouch({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }, null), true);
  assert.equal(appleTouch({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 }, null), false);
  assert.equal(appleTouch({ userAgent: "Mozilla/5.0 (Linux; Android 14)", maxTouchPoints: 5 }, null), false);
});
