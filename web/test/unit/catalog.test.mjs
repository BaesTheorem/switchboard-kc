// catalog.js against ios/KC311/Sources/Sections.swift and ReportBrowse.swift.
// The expected sections and the A to Z order come from the Swift rules
// (first matching section; localizedCaseInsensitiveCompare), not from the JS.

import assert from "node:assert/strict";
import test from "node:test";
import { directory, generalLinks, OTHER, PHONES_MORE, PHONES_PINNED, sectionOf } from "../../public/js/catalog.js";
import { Category, readCatalog } from "../../public/js/models.js";

// Every category name in the live catalog (list_report_categories,
// 2026-10-20), with the section Sections.swift gives it.
const LIVE = [
  ["311 Request Update", "other"], ["A Pothole", "streets"], ["Animal Services", "animals"], ["Bike Lanes", "traffic"],
  ["Bridge", "streets"], ["Contract and Labor Violations", "rights"], ["Discrimination Report", "rights"],
  ["Food Safety", "safety"], ["Graffiti", "streets"], ["Hate/Bigotry Incident", "safety"],
  ["Health Code Violations", "safety"], ["Healthy Homes", "property"], ["Tents or Sleeping Structures", "property"],
  ["Illegal Dumping", "trash"], ["Land Bank Issues", "property"], ["Leaf and Brush Curbside Pickup", "trash"],
  ["Parking Meter issues", "traffic"], ["Parks and Recreation", "parks"], ["Property Violations", "property"],
  ["Public Safety", "safety"], ["Recycling Cart Program", "trash"], ["Right-of-Way / Inspections", "streets"],
  ["Sewer and Stormwater", "water"], ["Short Term Rental", "property"], ["Sidewalks and Curbs", "streets"],
  ["Snow", "streets"], ["Solid Waste Services", "trash"], ["Street Cleaning / Sweeping", "streets"],
  ["Street Maintenance", "streets"], ["Streetlights", "traffic"], ["Traffic Calming or Concerns", "traffic"],
  ["Traffic Signals", "traffic"], ["Traffic Signs and Street Markings", "traffic"],
  ["Trash  Recycling  Bulky Services", "trash"], ["Trash Cart Program", "trash"], ["Trees City Row", "parks"],
  ["Vehicles and Parking", "traffic"], ["Vision Zero Feedback", "traffic"], ["Water Service", "water"],
  ["Water, Sewer, Stormwater Issues", "water"], ["Zoning and Permits", "property"],
];

const cat = (name) => new Category({ cat_id: name, name }, []);

test("sectionOf files each live category name as Sections.swift does", () => {
  assert.equal(LIVE.length, 41);
  for (const [name, id] of LIVE) assert.equal(sectionOf(cat(name)).id, id, name);
});

test("sectionOf: the user's examples, and an unknown name goes to Other", () => {
  assert.equal(sectionOf(cat("Trash Cart Program")).title, "Trash & Recycling");
  assert.equal(sectionOf(cat("A Pothole")).title, "Streets & Sidewalks");
  assert.equal(sectionOf(cat("Streetlights")).title, "Traffic, Parking & Lights");
  assert.equal(sectionOf(cat("Water Service")).title, "Water & Sewer");
  assert.equal(sectionOf(cat("Animal Services")).title, "Animals");
  assert.equal(sectionOf(cat("Noise Complaint")), OTHER);
  assert.equal(OTHER.title, "Other");
});

test("the phone numbers match CityPhones in Sections.swift", () => {
  assert.deepEqual(PHONES_PINNED.map((p) => [p.name, p.number, !!p.text]), [
    ["Call 311", "816-513-1313", false], ["Police non-emergency", "816-234-5111", false],
    ["KC Streetcar Authority", "816-627-2527", false], ["KC Streetcar See Say (text dispatch)", "816-837-4800", true],
  ]);
  assert.deepEqual(PHONES_MORE.map((p) => [p.name, p.number]), [
    ["Animal bite, after hours", "816-788-0725"], ["Barking dogs (KC Pet Project)", "816-683-1373"],
    ["Beekeeper registration", "816-513-6048"], ["Civil Rights and Equal Opportunity", "816-513-1836"],
    ["Crosswalk Restoration Program", "816-513-9870"], ["Environmental compliance, illicit discharge", "816-513-0600"],
    ["Fire appearances and station tours", "816-513-6464"], ["Fire Marshal, smoke detectors", "816-513-4648"],
    ["Food handler cards (Health Department)", "816-513-6315"], ["HUD housing discrimination", "800-669-9777"],
    ["Human trafficking hotline", "888-373-7888"], ["KC Water, account shut off", "816-513-0567"],
    ["KC Water, lead service line hotline", "816-513-0150"], ["KCPD community complaints", "816-889-6640"],
    ["KCPD information", "816-234-5000"], ["KCPD records", "816-234-5100"], ["KCPD video requests", "816-234-5589"],
    ["MoDOT (highways and ramps)", "816-607-2000"], ["Parks facility reservations", "816-513-0632"],
    ["PIAC sidewalk requests", "816-513-8828"], ["Regulated industries licenses", "816-513-4560"],
    ["Towed vehicles, reclaim", "816-513-0668"], ["Tow lot (7750 E Front St)", "816-513-0688"],
    ["Traffic calming", "816-513-9886"], ["Wildlife (Lakeside Nature Center)", "816-513-8960"],
  ]);
});

// A small catalog in the shape the server sends (trimmed get_main tables).
// Names and sub-type order are from the live catalog; the ids of Streetlights,
// 311 Request Update, and the alley sub-type are made up.
const TABLES = {
  RAI_CATEGORY: [
    { cat_id: "53842", server_id: "53842", name: "A Pothole", type: "Standard", sort_order: "2" },
    { cat_id: "11099", server_id: "11099", name: "Streetlights", type: "Standard", sort_order: "1" },
    { cat_id: "10999", server_id: "10999", name: "311 Request Update", type: "form_type", sort_order: "3" },
  ],
  RAI_SUBCATEGORY: [
    { subcat_id: "44019", server_id: "44019", category_id: "53842", name: "Pothole in the Street", cat_order: "2", type: "form_type" },
    { subcat_id: "44018", server_id: "44018", category_id: "53842", name: "Pothole in the Alley", cat_order: "1", type: "form_type" },
  ],
  MENU: [
    { menu_item_name: "Bulky Item Pickup", menu_item_url: "https://www.kcmo.gov/bulky", menu_item_type: "HTML" },
    { menu_item_name: "Municipal Court", ios_url: "https://www.kcmo.gov/court", menu_item_type: "HTML" },
  ],
};

test("directory: every report type, page, and phone number, A to Z", () => {
  const { categories, links } = readCatalog(TABLES);
  const items = directory(categories, links);
  // localizedCaseInsensitiveCompare order of the 35 titles.
  assert.deepEqual(items.map((i) => i.title), [
    "Animal bite, after hours", "Barking dogs (KC Pet Project)", "Beekeeper registration", "Call 311",
    "Civil Rights and Equal Opportunity", "Crosswalk Restoration Program", "Environmental compliance, illicit discharge",
    "Fire appearances and station tours", "Fire Marshal, smoke detectors", "Food handler cards (Health Department)",
    "HUD housing discrimination", "Human trafficking hotline", "KC Streetcar Authority", "KC Streetcar problem",
    "KC Streetcar See Say (text dispatch)", "KC Water, account shut off", "KC Water, lead service line hotline",
    "KCPD community complaints", "KCPD information", "KCPD records", "KCPD video requests", "MoDOT (highways and ramps)",
    "Municipal Court", "Parks facility reservations", "PIAC sidewalk requests", "Police non-emergency",
    "Pothole in the Alley", "Pothole in the Street", "Regulated industries licenses", "Schedule a bulky item pickup",
    "Streetlights", "Tow lot (7750 E Front St)", "Towed vehicles, reclaim", "Traffic calming",
    "Wildlife (Lakeside Nature Center)",
  ]);
  const by = (title) => items.find((i) => i.title === title);

  // A category without sub-types is one row; each sub-type is a row under its category.
  assert.equal(by("Streetlights").kind, "report");
  assert.equal(by("Streetlights").detail, "Traffic, Parking & Lights");
  assert.equal(by("Streetlights").icon, "lightbulb");
  assert.equal(by("Streetlights").sub, null);
  const street = by("Pothole in the Street");
  assert.equal(street.kind, "report");
  assert.equal(street.detail, "A Pothole · Streets & Sidewalks");
  assert.equal(street.icon, "road");
  assert.equal(street.cat.id, "53842");
  assert.equal(street.sub.subcat_id, "44019");
  assert.equal(items.some((i) => i.title === "A Pothole"), false, "a category with sub-types has no row of its own");
  assert.equal(items.some((i) => /request update/i.test(i.title)), false, "update requests are not report types");

  // City pages: the clearer label, and the section that owns the link or "City".
  assert.equal(by("Schedule a bulky item pickup").kind, "link");
  assert.equal(by("Schedule a bulky item pickup").detail, "Web page · Trash & Recycling");
  assert.equal(by("Schedule a bulky item pickup").icon, "chair");
  assert.equal(by("Municipal Court").detail, "Web page · City");
  assert.equal(by("Municipal Court").icon, "gavel");

  // Phones: the number as the detail, "sms" for the text line.
  assert.equal(by("Call 311").kind, "phone");
  assert.equal(by("Call 311").detail, "816-513-1313");
  assert.equal(by("Call 311").icon, "call");
  assert.equal(by("KC Streetcar See Say (text dispatch)").icon, "sms");

  const sc = by("KC Streetcar problem");
  assert.equal(sc.kind, "streetcar");
  assert.equal(sc.detail, "Streetcar Authority, not 311");
  assert.equal(sc.icon, "tram");
});

test("generalLinks keeps only the links that no section claims", () => {
  const names = ["Bulky Item Pickup", "Recycling Carts", "Leaf and Brush", "Snowplow Map", "Snow and Trash Update",
    "Make a Police Report", "KC Water", "Municipal Court", "Pay a Parking Ticket"];
  const links = names.map((name) => ({ name, url: "https://www.kcmo.gov/" }));
  assert.deepEqual(generalLinks(links).map((l) => l.name), ["Municipal Court", "Pay a Parking Ticket"]);
});
