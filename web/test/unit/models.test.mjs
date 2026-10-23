// models.js against ios/KC311/Sources/Models.swift and docs/API.md. The
// expected values come from the Swift code and the docs, not from the JS.

import assert from "node:assert/strict";
import test from "node:test";
import {
  Category, cityCaseNumber, cleanName, epoch, mapIssue, myReport, num, parseQuestions, reportDetail, stage, str, stripHTML,
} from "../../public/js/models.js";

const H = 3600e3;
const NOW = Date.UTC(2026, 9, 10, 18, 0, 0);
const sec = (ms) => String(ms / 1000);

// The pothole question, verbatim from the sub-type in docs/API.md section 7.2.
const POTHOLE_FORM = "[{\"type\":4,\"caption\":\"Number of Potholes\",\"placeholder\":\"\",\"sort_order\":1,\"IS_INPUT_REQUIRED\":\"yes\",\"allow_multiple_select\":\"no\",\"dropdown_options\":[{\"id\":\"One pothole\",\"value\":\"One pothole\"},{\"id\":\"Multiple potholes\",\"value\":\"Multiple potholes\"},{\"id\":\"Entire block\",\"value\":\"Entire block\"}]}]";

// ---------- str, num, epoch ----------

test("str reads strings and numbers and nothing else", () => {
  const d = { s: "Pothole", n: 53842, f: 39.0997, z: 0, nul: null, obj: { a: 1 }, arr: ["x"] };
  assert.equal(str(d, "s"), "Pothole");
  assert.equal(str(d, "n"), "53842");
  assert.equal(str(d, "f"), "39.0997");
  assert.equal(str(d, "z"), "0");
  assert.equal(str(d, "nul"), "");
  assert.equal(str(d, "obj"), "");
  assert.equal(str(d, "arr"), "");
  assert.equal(str(d, "missing"), "");
  assert.equal(str(null, "s"), "");
});

test("str reads a JSON boolean as Swift's NSNumber does", () => {
  // JSONSerialization gives true/false as NSNumber, and str() returns its stringValue.
  assert.equal(str({ b: true }, "b"), "1");
  assert.equal(str({ b: false }, "b"), "0");
});

test("num parses numbers and numeric strings, and gives null for the rest", () => {
  assert.equal(num({ a: "39.0997" }, "a"), 39.0997);
  assert.equal(num({ a: -94.5786 }, "a"), -94.5786);
  assert.equal(num({ a: "0" }, "a"), 0);
  assert.equal(num({ a: "" }, "a"), null);
  assert.equal(num({ a: "abc" }, "a"), null);
  assert.equal(num({ a: null }, "a"), null);
  assert.equal(num({}, "a"), null);
});

test("num reads a padded numeric string (the web is more lenient than Swift's Double(String) here, on purpose)", () => {
  assert.equal(num({ a: " 39.1" }, "a"), 39.1);
  assert.equal(num({ a: "39.1 " }, "a"), 39.1);
});

test("epoch reads epoch seconds as a Date, and 0, negative, or missing as null", () => {
  assert.deepEqual(epoch({ t: "1791232365" }, "t"), new Date(1791232365000));
  assert.deepEqual(epoch({ t: 1791232365 }, "t"), new Date(1791232365000));
  assert.equal(epoch({ t: 0 }, "t"), null);
  assert.equal(epoch({ t: "0" }, "t"), null);
  assert.equal(epoch({ t: -1 }, "t"), null);
  assert.equal(epoch({ t: "" }, "t"), null);
  assert.equal(epoch({}, "t"), null);
});

// ---------- names and text ----------

test("cleanName shows the city's double spaces as commas", () => {
  assert.equal(cleanName("Trash  Recycling  Bulky Services"), "Trash, Recycling, Bulky Services");
  assert.equal(cleanName("Water, Sewer, Stormwater Issues"), "Water, Sewer, Stormwater Issues");
  assert.equal(cleanName("Snow "), "Snow");
  assert.equal(cleanName(""), "");
});

test("stripHTML removes tags, decodes &nbsp; and &amp;, and trims", () => {
  assert.equal(stripHTML("<p>Crew&nbsp;sent &amp; done</p>\n"), "Crew sent & done");
  assert.equal(stripHTML("<a href=\"https://www.kcmo.gov\">KCMO</a> page"), "KCMO page");
  assert.equal(stripHTML("  plain text  "), "plain text");
  assert.equal(stripHTML(""), "");
});

test("stripHTML decodes &amp; once only", () => {
  // Swift turns "&amp;lt;" into the text "&lt;", not into "<".
  assert.equal(stripHTML("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
});

test("stripHTML keeps a <br> as a line break and decodes the common entities (Swift joins the words; the iPhone app should follow this)", () => {
  assert.equal(stripHTML("Line one<br>Line two"), "Line one\nLine two");
  assert.equal(stripHTML("5 &lt; 6 &quot;ok&quot;"), '5 < 6 "ok"');
});

test("cityCaseNumber reads thirdparty_params as a JSON string or an object", () => {
  assert.equal(cityCaseNumber({ thirdparty_params: "{\"case_number\":\"376006\"}" }), "376006");
  assert.equal(cityCaseNumber({ thirdparty_params: { case_number: "376006" } }), "376006");
  assert.equal(cityCaseNumber({ thirdparty_params: { case_number: 376006 } }), "376006");
  assert.equal(cityCaseNumber({ thirdparty_params: "" }), "");
  assert.equal(cityCaseNumber({ thirdparty_params: "not json" }), "");
  assert.equal(cityCaseNumber({ thirdparty_params: {} }), "");
  assert.equal(cityCaseNumber({}), "");
  assert.equal(cityCaseNumber({ display_wo: "376006" }), "", "never display_wo, which is MyCivic's own id before the sync");
});

// ---------- questions ----------

test("parseQuestions reads the pothole question from docs/API.md 7.2", () => {
  const qs = parseQuestions(POTHOLE_FORM);
  assert.equal(qs.length, 1);
  const [q] = qs;
  assert.equal(q.caption, "Number of Potholes");
  assert.equal(q.kind, 4);
  assert.equal(q.placeholder, "");
  assert.equal(q.required, true);
  assert.equal(q.multiple, false);
  assert.equal(q.sortOrder, 1);
  assert.deepEqual(q.options, [
    { id: "One pothole", value: "One pothole" },
    { id: "Multiple potholes", value: "Multiple potholes" },
    { id: "Entire block", value: "Entire block" },
  ]);
});

test("parseQuestions sorts by sort_order, reads \"yes\" and \"1\" as required, and drops unknown types", () => {
  const raw = JSON.stringify([
    { type: 3, caption: "C", sort_order: 3, IS_INPUT_REQUIRED: "no", placeholder: "Type here" },
    { type: "1", caption: "A", sort_order: "1", IS_INPUT_REQUIRED: "1" },
    { type: 9, caption: "Unknown kind", sort_order: 0, IS_INPUT_REQUIRED: "yes" },
    { type: 4, caption: "B", sort_order: 2, IS_INPUT_REQUIRED: "YES", allow_multiple_select: "yes" },
    { type: 6, caption: "D", sort_order: 4, IS_INPUT_REQUIRED: "0" },
  ]);
  const qs = parseQuestions(raw);
  assert.deepEqual(qs.map((q) => q.caption), ["A", "B", "C", "D"]);
  assert.deepEqual(qs.map((q) => q.kind), [1, 4, 3, 6]);
  assert.deepEqual(qs.map((q) => q.required), [true, true, false, false]);
  assert.deepEqual(qs.map((q) => q.multiple), [false, true, false, false]);
  assert.deepEqual(qs.map((q) => q.options), [[], [], [], []]);
  assert.equal(qs[2].placeholder, "Type here");
});

test("parseQuestions gives [] for empty or bad form_data", () => {
  assert.deepEqual(parseQuestions(""), []);
  assert.deepEqual(parseQuestions(undefined), []);
  assert.deepEqual(parseQuestions("not json"), []);
  assert.deepEqual(parseQuestions("{\"type\":3,\"caption\":\"x\"}"), []);
});

// ---------- categories ----------

test("Category.value: a sub-type's non-empty value wins over its category's", () => {
  const c = new Category({ cat_id: "1", location_required: "no", autoresponse_text: "Category text" }, []);
  const sub = { subcat_id: "11", location_required: "yes", autoresponse_text: "" };
  assert.equal(c.value("location_required", sub), "yes");
  assert.equal(c.value("autoresponse_text", sub), "Category text");
  assert.equal(c.value("location_required", null), "no");
  assert.equal(c.value("missing_key", sub), "");
});

test("Category.questions: form_data comes from the sub-type only when its type is non-empty", () => {
  const catForm = JSON.stringify([{ type: 3, caption: "Category question", sort_order: 1 }]);
  const subForm = JSON.stringify([{ type: 3, caption: "Sub question", sort_order: 1 }]);
  const c = new Category({ cat_id: "1", type: "form_type", form_data: catForm }, []);
  const captions = (sub) => c.questions(sub).map((q) => q.caption);
  assert.deepEqual(captions({ type: "form_type", form_data: subForm }), ["Sub question"]);
  assert.deepEqual(captions({ type: "", form_data: subForm }), ["Category question"]);
  assert.deepEqual(captions({ type: "form_type", form_data: "" }), ["Category question"]);
  assert.deepEqual(captions(null), ["Category question"]);
});

test("Category.effectiveType: the sub-type's type wins, an empty one inherits, the default is Standard", () => {
  const c = new Category({ cat_id: "53842", type: "Standard" }, []);
  assert.equal(c.effectiveType({ type: "form_type" }), "form_type");
  assert.equal(c.effectiveType({ type: "" }), "Standard");
  assert.equal(c.effectiveType(null), "Standard");
  assert.equal(new Category({ cat_id: "2", type: "form_type" }, []).effectiveType({ type: "" }), "form_type");
  assert.equal(new Category({ cat_id: "3", type: "" }, []).effectiveType({ type: "" }), "Standard");
});

// ---------- my reports ----------

test("myReport: filing time is the earlier of added_on and updated_on, never later than now", () => {
  // myissues' added_on runs 2 hours ahead; updated_on, a UTC string, is right.
  const real = Date.UTC(2026, 9, 5, 14, 0, 0);
  const r = myReport({ id: "a1", added_on: sec(real + 2 * H), updated_on: "2026-10-05 14:00:00" }, NOW);
  assert.equal(r.added.getTime(), real);
  // Filed an hour ago: added_on is an hour in the future and there is no updated_on.
  const r2 = myReport({ id: "a2", added_on: sec(NOW + H) }, NOW);
  assert.equal(r2.added.getTime(), NOW);
  const r3 = myReport({ id: "a3" }, NOW);
  assert.equal(r3.added, null);
  assert.equal(r3.lastMovement, null);
});

test("myReport: last movement is the latest of filing, updated_on, and last_action_date, never later than now", () => {
  const filed = sec(Date.UTC(2026, 9, 1, 12, 0, 0));
  const r = myReport({ id: "b1", added_on: filed, updated_on: "2026-10-07 09:30:00", last_action_date: "10/09/2026" }, NOW);
  assert.equal(r.added.getTime(), Date.UTC(2026, 9, 1, 12, 0, 0));
  assert.equal(r.lastMovement.getTime(), Date.UTC(2026, 9, 9));
  const r2 = myReport({ id: "b2", added_on: filed, updated_on: "2026-10-07 09:30:00" }, NOW);
  assert.equal(r2.lastMovement.getTime(), Date.UTC(2026, 9, 7, 9, 30, 0));
  const r3 = myReport({ id: "b3", added_on: filed }, NOW);
  assert.equal(r3.lastMovement.getTime(), Date.UTC(2026, 9, 1, 12, 0, 0));
  const r4 = myReport({ id: "b4", added_on: filed, last_action_date: "10/12/2026" }, NOW);
  assert.equal(r4.lastMovement.getTime(), NOW);
});

test("myReport reads the fields and cleans the names", () => {
  const r = myReport({
    id: "c1", name: "Trash  Recycling  Bulky Services", subcategory: "Missed  Pickup", status: "received",
    description: "Cart not emptied", address: "4131 E Truman Rd", latitude: "39.0937", longitude: "-94.534",
    new_update_count: "2", thirdparty_params: "{\"case_number\":\"376006\"}", display_wo: "999",
  }, NOW);
  assert.equal(r.id, "c1");
  assert.equal(r.caseNumber, "376006");
  assert.equal(r.category, "Trash, Recycling, Bulky Services");
  assert.equal(r.subcategory, "Missed, Pickup");
  assert.equal(r.label, "Missed, Pickup");
  assert.equal(r.status, "received");
  assert.equal(r.description, "Cart not emptied");
  assert.equal(r.address, "4131 E Truman Rd");
  assert.equal(r.lat, 39.0937);
  assert.equal(r.lng, -94.534);
  assert.equal(r.unread, 2);
  assert.equal(r.isOpen, true);
  assert.equal(r.isUpdateRequest, false);

  const r2 = myReport({ id: "c2", issue_type: "Streetlights", sub_type: "", status: "Resolved" }, NOW);
  assert.equal(r2.category, "Streetlights");
  assert.equal(r2.label, "Streetlights");
  assert.equal(r2.isOpen, false);
  assert.equal(r2.unread, 0);
  assert.equal(r2.lat, null);
});

test("myReport: an update request is known by its category name or by its description", () => {
  assert.equal(myReport({ id: "u1", name: "311 Request Update", status: "new" }, NOW).isUpdateRequest, true);
  // The city files the request as "Administration or Questions", so only the text shows what it is.
  const byText = myReport({ id: "u2", name: "Administration or Questions",
    description: "\n  Please send an update on request #376006: Pothole in the Street." }, NOW);
  assert.equal(byText.isUpdateRequest, true);
  const notOne = myReport({ id: "u3", name: "A Pothole", description: "Deep hole. Please send an update on it." }, NOW);
  assert.equal(notOne.isUpdateRequest, false);
});

// ---------- status ----------

test("stage maps MyCivic statuses to Sent, Received, In progress, Done", () => {
  const cases = [["new", 0], ["", 0], ["received", 1], ["Received", 1], ["assigned", 2], ["referred", 2],
    ["In Progress", 2], ["active", 2], ["scheduled", 2], ["resolved", 3], ["Closed", 3], ["canceled", 3],
    ["cancelled", 3], ["completed", 3]];
  for (const [status, step] of cases) assert.equal(stage(status), step, status);
});

test("stage: a staff note on an open report counts as in progress", () => {
  const staff = [{ title: "Report received" }, { title: "Staff Note" }];
  assert.equal(stage("received", staff), 2);
  assert.equal(stage("new", [{ title: "staff note" }]), 2);
  assert.equal(stage("assigned", staff), 2);
  assert.equal(stage("resolved", staff), 3);
  assert.equal(stage("received", [{ title: "Report received" }]), 1);
  assert.equal(stage("received", []), 1);
});

// ---------- map pins ----------

test("mapIssue reads a public pin (docs/API.md 6.3)", () => {
  const m = mapIssue({
    report_id: "9001", issue_type: "form_type", issue_name: "Trash  Recycling  Bulky Services", subtype: "Missed  Pickup",
    issue_status: "open", issue_address: "4131 E Truman Rd", issue_latitude: 39.0937, issue_longitude: -94.534,
    issue_submitted_date: 1791232365, issue_lastupdated_date: 1791318765,
    issue_description: "<p>Cart&nbsp;not emptied &amp; left</p>", thirdparty_params: { case_number: "376006" },
  });
  assert.equal(m.id, "9001");
  assert.equal(m.type, "Trash, Recycling, Bulky Services");
  assert.equal(m.subtype, "Missed, Pickup");
  assert.equal(m.status, "open");
  assert.equal(m.address, "4131 E Truman Rd");
  assert.equal(m.lat, 39.0937);
  assert.equal(m.lng, -94.534);
  assert.equal(m.submitted, 1791232365000);
  assert.equal(m.updated, 1791318765000);
  assert.equal(m.details, "Cart not emptied & left");
  assert.equal(m.caseNumber, "376006");
});

test("mapIssue skips a pin without a position", () => {
  assert.equal(mapIssue({ report_id: "1", issue_latitude: "", issue_longitude: -94.5 }), null);
  assert.equal(mapIssue({ report_id: "1", issue_latitude: 39.1 }), null);
  const zero = mapIssue({ report_id: "1", issue_latitude: "0", issue_longitude: "0" });
  assert.ok(zero, "Double(\"0\") is a position in Swift");
  assert.equal(zero.submitted, null);
  assert.equal(zero.caseNumber, "");
});

// ---------- reportDetail ----------

test("reportDetail opens the note box only when the city allows it (docs/API.md section 5.1)", () => {
  assert.equal(reportDetail({ citizen_allow_to_send_note: 1 }).canAddNote, true);
  assert.equal(reportDetail({ citizen_allow_to_send_note: "1" }).canAddNote, true);
  assert.equal(reportDetail({ citizen_allow_to_send_note: 0 }).canAddNote, false);
  assert.equal(reportDetail({}).canAddNote, false);
});
