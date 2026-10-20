// place.js against ios/KC311/Sources/Place.swift and Support.swift
// (uspsAbbreviated). Expected values come from the Swift code.

import assert from "node:assert/strict";
import test from "node:test";
import { answerFor, factsLine, ordinal, summary, uspsAbbreviated } from "../../public/js/place.js";

test("uspsAbbreviated shortens directions and street types, word by word", () => {
  assert.equal(uspsAbbreviated("4131 East Truman Road"), "4131 E Truman Rd");
  assert.equal(uspsAbbreviated("West 39th Street"), "W 39th St");
  assert.equal(uspsAbbreviated("North Oak Trafficway"), "N Oak Trfy");
  assert.equal(uspsAbbreviated("Ward Parkway"), "Ward Pkwy");
  assert.equal(uspsAbbreviated("South Grand Boulevard"), "S Grand Blvd");
  assert.equal(uspsAbbreviated("Southwest Trafficway"), "Southwest Trfy", "only whole words in the table change");
  assert.equal(uspsAbbreviated("Eastwood Avenue"), "Eastwood Ave");
  assert.equal(uspsAbbreviated("Main"), "Main");
  assert.equal(uspsAbbreviated(""), "");
});

test("uspsAbbreviated drops empty words, as Swift's split(separator:) does", () => {
  assert.equal(uspsAbbreviated("4131  East Truman Road "), "4131 E Truman Rd");
  assert.equal(uspsAbbreviated(" Main Street"), "Main St");
});

test("ordinal adds the suffix that TIGER road names leave off", () => {
  assert.equal(ordinal("12 St"), "12th St");
  assert.equal(ordinal("11 St"), "11th St");
  assert.equal(ordinal("22 Ter"), "22nd Ter");
  assert.equal(ordinal("1 Ave"), "1st Ave");
  assert.equal(ordinal("3 Pl"), "3rd Pl");
  assert.equal(ordinal("13 St"), "13th St");
  assert.equal(ordinal("20 Rd"), "20th Rd");
  assert.equal(ordinal("21 Dr"), "21st Dr");
  assert.equal(ordinal("101 Ln"), "101st Ln");
  assert.equal(ordinal("111 Cir"), "111th Cir");
  assert.equal(ordinal("E 63 St"), "E 63rd St");
  assert.equal(ordinal("W 39 Ter and 40 Ct"), "W 39th Ter and 40th Ct");
  assert.equal(ordinal("Main St"), "Main St");
  assert.equal(ordinal("12 Street"), "12 Street", "the type must end at a word boundary");
});

// Place facts as Place.facts() builds them.
const F = {
  lat: 39.0997, lng: -94.5786, source: "phone GPS",
  address: "414 E 12th St, Kansas City, MO 64106", street: "E 12th St", crossStreet: "Oak St",
  intersection: "E 12th St & Oak St (about 20 m away)",
};
const SUMMARY = "GPS 39.099700, -94.578600 (phone GPS); nearest address 414 E 12th St, Kansas City, MO 64106; "
  + "nearest intersection E 12th St & Oak St (about 20 m away)";

test("summary and factsLine use the format in PlaceFacts", () => {
  assert.equal(summary(F), SUMMARY);
  assert.equal(factsLine(F), `Location: ${SUMMARY}.`);
  const bare = { lat: 39.05643, lng: -94.58612, source: "photo GPS", address: "", street: "", crossStreet: "", intersection: "" };
  assert.equal(summary(bare), "GPS 39.056430, -94.586120 (photo GPS)");
  assert.equal(factsLine(bare), "Location: GPS 39.056430, -94.586120 (photo GPS).");
  const noCross = { ...F, intersection: "" };
  assert.equal(summary(noCross), "GPS 39.099700, -94.578600 (phone GPS); nearest address 414 E 12th St, Kansas City, MO 64106");
});

test("answerFor: Street and Cross Street get the street names", () => {
  assert.equal(answerFor(F, "Street"), "E 12th St");
  assert.equal(answerFor(F, " street "), "E 12th St");
  assert.equal(answerFor(F, "Cross Street"), "Oak St");
  assert.equal(answerFor(F, "Intersecting Street"), "Oak St");
  assert.equal(answerFor({ ...F, street: "" }, "Street"), null, "an empty street gives nil, not the summary");
  assert.equal(answerFor({ ...F, crossStreet: "" }, "Cross street"), null);
});

test("answerFor: questions that ask where get the summary", () => {
  for (const caption of ["Location of issue", "Address or intersection", "Nearest intersection",
    "Specific address of the problem", "Area of traffic concern", "Area of concern", "Where is the animal?",
    "Where are services needed?", "Street/Location", "Street / Location"]) {
    assert.equal(answerFor(F, caption), SUMMARY, caption);
  }
});

test("answerFor: questions about people, counts, and times get nothing", () => {
  for (const caption of ["Your email address", "How many potholes are at this location?", "Business location",
    "Current address", "Location of the rental property", "Employer location", "When did this happen?",
    "Description", "Your name"]) {
    assert.equal(answerFor(F, caption), null, caption);
  }
});
