// pay.js against the city's Pay Online page (kcmo.gov/city-hall/pay-online,
// read 2026-11-12): the payments and the address of each office's page.

import assert from "node:assert/strict";
import test from "node:test";
import { IN_PERSON, isPayLink, PAYMENTS } from "../../public/js/pay.js";

test("twelve payments, each with a name of its own and a secure address", () => {
  assert.equal(PAYMENTS.length, 12);
  assert.equal(new Set(PAYMENTS.map((p) => p.name)).size, 12);
  for (const p of PAYMENTS) {
    assert.match(p.url, /^https:\/\//, p.name);
    assert.ok(p.icon, p.name);
  }
});

test("the payments a resident meets most come first, at the addresses the city names", () => {
  assert.deepEqual(PAYMENTS.slice(0, 4).map((p) => p.name), ["Water bill", "Parking ticket", "Court ticket or fine", "City taxes"]);
  const url = (name) => PAYMENTS.find((p) => p.name === name).url;
  assert.equal(url("Water bill"), "https://my.kcwater.us/eportal/#/accountlookup/pay");
  assert.equal(url("Parking ticket"), "https://parkkcmo.com/");
  assert.equal(url("City taxes"), "https://quicktax.kcmo.org/kcp/tap/_/");
  // One payment company takes the ambulance bills and the rent for leased city property.
  assert.equal(url("Ambulance bill"), url("Rent for leased city property"));
});

test("the water bill has the phone line, and towing fees are in person only", () => {
  assert.equal(PAYMENTS[0].phone, "816-513-0567");
  assert.ok(IN_PERSON.some((t) => t.startsWith("Towing fees: only in person") && t.includes("No cash")));
});

test("isPayLink knows the city's menu link", () => {
  assert.ok(isPayLink({ name: "Pay Online" }));
  assert.ok(!isPayLink({ name: "KC Water" }));
  assert.ok(!isPayLink(null));
});
