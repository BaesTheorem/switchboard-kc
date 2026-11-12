// police.js against the police department's pages (www.kcpolice.org, read
// 2026-11-12): the report types in the department's order, the address of
// its form for each type, and the numbers.

import assert from "node:assert/strict";
import test from "node:test";
import { isPoliceLink, NON_EMERGENCY, POLICE_RULES, POLICE_TYPES, policeFormUrl, RECORDS } from "../../public/js/police.js";

test("the 13 report types, in the department's order", () => {
  assert.deepEqual(POLICE_TYPES.map((t) => t.name), [
    "Accident: hit and run", "Accident: no injury", "Child custody violation", "Drug activity tip", "Extra patrol request",
    "Fraudulent use of a credit device", "Identity theft", "Lost property", "Phone harassment", "Property or vehicle damage",
    "Shoplifting (loss under $2,000)", "Theft (value under $2,000)", "Traffic complaint",
  ]);
});

test("twelve types open a form at LexisNexis, numbered in a row, and one opens a department page", () => {
  const forms = POLICE_TYPES.filter((t) => t.form);
  assert.deepEqual(forms.map((t) => t.form), Array.from({ length: 12 }, (_, i) => 300010003 + i));
  assert.equal(policeFormUrl(forms[0]), "https://secure.coplogic.com/dors/startreport/300005194/300010003");
  assert.equal(policeFormUrl(forms[11], true), "https://secure.coplogic.com/dors/startreport/300005194/300010014/es");
  const traffic = POLICE_TYPES.at(-1);
  assert.equal(policeFormUrl(traffic), "https://www.kcpolice.org/crime/prevention-and-safety-tips/traffic-complaints/");
  assert.equal(policeFormUrl(traffic, true), policeFormUrl(traffic), "the traffic page has no Spanish form");
});

test("a known suspect is accepted for the four types the department names", () => {
  assert.deepEqual(POLICE_TYPES.filter((t) => t.suspect).map((t) => t.name),
    ["Child custody violation", "Drug activity tip", "Shoplifting (loss under $2,000)", "Traffic complaint"]);
});

test("no address uses the host with the expired certificate", () => {
  const all = [...POLICE_TYPES.map((t) => policeFormUrl(t)), RECORDS.request, RECORDS.crash, RECORDS.fees];
  for (const u of all) {
    assert.match(u, /^https:\/\/(secure\.coplogic\.com|www\.kcpolice\.org)\//);
    assert.ok(!u.includes("kcpd.org"), u);
  }
});

test("the numbers and the conditions", () => {
  assert.equal(NON_EMERGENCY, "816-234-5111");
  assert.equal(RECORDS.phone, "816-234-5100");
  assert.equal(POLICE_RULES.length, 6);
});

test("isPoliceLink knows the city's menu link", () => {
  assert.ok(isPoliceLink({ name: "Make a Police Report" }));
  assert.ok(!isPoliceLink({ name: "Municipal Court" }));
  assert.ok(!isPoliceLink(null));
});
