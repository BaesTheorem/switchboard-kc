// draft.js against ios/KC311/Sources/ReportDraft.swift and docs/API.md
// sections 3 and 7. Expected values come from the Swift code and the docs.

import assert from "node:assert/strict";
import test from "node:test";
import { Draft, KANSAS_CITY } from "../../public/js/draft.js";
import { readZip } from "../../public/js/lib/zip.js";
import { Category } from "../../public/js/models.js";

const DEVICE = "3f9c2a7b5e1d4c08";

// The "Pothole in the Street" sub-type, verbatim from docs/API.md section 7.2.
const POTHOLE_STREET = {
  subcat_id: "44019",
  server_id: "44019",
  name: "Pothole in the Street",
  category_id: "53842",
  menu_id: "10871",
  autoresponse_text: "Currently Public Works is dealing with a high level of requests, and it can take up to 60 days to resolve. We appreciate your reporting and patience.",
  cat_order: "2",
  enable_disclaimer: "yes",
  form_data: "[{\"type\":4,\"caption\":\"Number of Potholes\",\"placeholder\":\"\",\"sort_order\":1,\"IS_INPUT_REQUIRED\":\"yes\",\"allow_multiple_select\":\"no\",\"dropdown_options\":[{\"id\":\"One pothole\",\"value\":\"One pothole\"},{\"id\":\"Multiple potholes\",\"value\":\"Multiple potholes\"},{\"id\":\"Entire block\",\"value\":\"Entire block\"}]}]",
  type: "form_type",
  thirdparty_type: "17",
  thirdparty_id: "Streets / Roadways / Alleys-Pothole",
  contact_info_required: "no",
  login_required: "no",
  location_required: "yes",
  description_required: "no",
  no_entry: "no",
  attachment_required: "no",
  enable_duplicate_issues: "yes",
  prevent_duplicate_issue: "2",
  issue_access: "all",
  disclaimer_title: "Important!",
  disclaimer_text: "Kansas City only repairs potholes found on city streets within city limits. If you encounter potholes on highways or on/off ramps, please notify MODOT at 816-607-2000",
  disclaimer_phone: "",
  disclaimer_url: "",
  disclaimer_email: "",
  disclaimer_json: "{\"total_scripts\":1,\"disclaimer_phone\":\"\",\"disclaimer_url\":\"\",\"disclaimer_email\":\"\",\"scripts\":[{\"id\":\"manual_1783433312041\",\"title\":\"Important!\",\"content\":\"Kansas City only repairs potholes found on city streets within city limits. If you encounter potholes on highways or on/off ramps, please notify MODOT at 816-607-2000\",\"order\":1,\"language\":\"en\",\"is_active\":true}]}",
  allow_image_uploads: "yes",
  mandatory_contact_info: { first_name: "no", last_name: "no", email: "no", phone: "no" },
};

// The live catalog's other pothole sub-type (get_report_subtypes, 2026-10-20). Its id is made up.
const POTHOLE_ALLEY = {
  subcat_id: "44018", server_id: "44018", name: "Pothole in the Alley", category_id: "53842", menu_id: "10871",
  cat_order: "1", type: "form_type", location_required: "yes",
  form_data: "[{\"type\":4,\"caption\":\"Number of Potholes\",\"placeholder\":\"\",\"sort_order\":1,\"IS_INPUT_REQUIRED\":\"yes\",\"allow_multiple_select\":\"no\",\"dropdown_options\":[{\"id\":\"One pothole\",\"value\":\"One pothole\"},{\"id\":\"Multiple potholes\",\"value\":\"Multiple potholes\"},{\"id\":\"Entire alley\",\"value\":\"Entire alley\"}]}]",
};

// The category row is not in the docs. cat_id and server_id are equal in KCMO (section 7.1).
const POTHOLE = { cat_id: "53842", server_id: "53842", name: "A Pothole", menu_id: "10871", type: "Standard", form_data: "", location_required: "yes", sort_order: "1" };

const LOCATION = { lat: 39.0937, lng: -94.534, street: "4131 E Truman Rd", city: "Kansas City", state: "MO", zip: "64127" };

function potholeDraft() {
  const d = new Draft("test");
  d.category = new Category(POTHOLE, [POTHOLE_ALLEY, POTHOLE_STREET]);
  d.sub = POTHOLE_STREET;
  d.choiceAnswers["Number of Potholes"] = ["Multiple potholes"];
  d.location = { ...LOCATION };
  d.notes = "Deep hole in the right lane.";
  return d;
}

// The SELECTED_SUB_TYPE keys in docs/API.md section 3.3.
const SUB_KEYS = ["Id", "category_id", "subCat_id", "name", "image", "cat_order", "type", "menu_id", "server_id",
  "autoresponse_text", "share_options", "sort_order", "login_required", "disclaimer_phone", "disclaimer_text",
  "disclaimer_title", "disclaimer_url", "enable_disclaimer", "disclosure", "form_data", "contact_info_required",
  "thirdparty_type", "thirdparty_id"];

test("payload: the pothole report in docs/API.md 7.2", async () => {
  const { issue, zip } = await potholeDraft().payload(DEVICE, null, KANSAS_CITY);
  assert.equal(issue.type, "form_type");
  assert.equal(issue.type_id, "53842");
  assert.equal(issue.name, "A Pothole");
  assert.equal(issue.issue_cat_id, "53842");
  assert.equal(issue.subtype, "Pothole in the Street");
  assert.equal(issue.city_id, "1adb57d07d9ea1e1dd8160697f745c0d");
  assert.equal(issue.menu_id, "10871");
  assert.equal(issue.deviceuid, DEVICE);
  assert.equal(issue.device_id, DEVICE);
  assert.equal(issue.api_version, "6.0");
  assert.equal(issue.notes, "Deep hole in the right lane.");
  assert.equal(issue.share_options, "public");
  assert.match(issue.timestamp, /^\d{13}$/, "milliseconds, as a string");
  assert.equal(issue.offline_timestamp, Number(issue.timestamp), "the same milliseconds, as a number");

  // The pin as JSON numbers, and the address fields.
  assert.equal(issue.RAI_LAT, 39.0937);
  assert.equal(issue.RAI_LONG, -94.534);
  assert.equal(issue.location, "4131 E Truman Rd");
  assert.equal(issue.address, "4131 E Truman Rd");
  assert.equal(issue.RAI_STREET, "4131 E Truman Rd");
  assert.equal(issue.RAI_CITY, "Kansas City");
  assert.equal(issue.RAI_STATE, "MO");
  assert.equal(issue.RAI_ZIP, "64127");

  // The answer is the option id (section 3.4), with the "enterdValue" spelling.
  assert.deepEqual(issue.form_data, { "Number of Potholes": "Multiple potholes" });
  assert.deepEqual(issue.new_form_data, [{ caption: "Number of Potholes", type: 4, sort_order: 1, enterdValue: "Multiple potholes" }]);

  assert.deepEqual(issue.files_metadata, []);
  assert.equal(zip, null);

  // Anonymous: Swift's key set when contact is nil.
  assert.deepEqual(Object.keys(issue).sort(), [
    "city_id", "menu_id", "timestamp", "deviceuid", "device_id", "type", "type_id", "name", "issue_cat_id", "subtype",
    "SELECTED_SUB_TYPE", "notes", "share_options", "files_metadata", "RAI_LAT", "RAI_LONG", "api_version",
    "offline_timestamp", "location", "address", "RAI_STREET", "RAI_CITY", "RAI_STATE", "RAI_ZIP", "form_data", "new_form_data",
  ].sort());
});

test("payload: SELECTED_SUB_TYPE copies the sub-type as docs/API.md 3.3 shows", async () => {
  const { issue } = await potholeDraft().payload(DEVICE, null);
  assert.equal(issue.SELECTED_SUB_TYPE.length, 1);
  const s = issue.SELECTED_SUB_TYPE[0];
  assert.deepEqual(Object.keys(s).sort(), [...SUB_KEYS].sort());
  assert.equal(s.Id, "44019");
  assert.equal(s.subCat_id, "44019");
  assert.equal(s.server_id, "44019");
  assert.equal(s.category_id, "53842");
  assert.equal(s.name, "Pothole in the Street");
  assert.equal(s.cat_order, "2");
  assert.equal(s.type, "form_type");
  assert.equal(s.menu_id, "10871");
  assert.equal(s.form_data, POTHOLE_STREET.form_data);
  assert.equal(s.autoresponse_text, POTHOLE_STREET.autoresponse_text);
  assert.equal(s.disclaimer_title, "Important!");
  assert.equal(s.disclaimer_text, POTHOLE_STREET.disclaimer_text);
  assert.equal(s.disclaimer_phone, "");
  assert.equal(s.disclaimer_url, "");
  assert.equal(s.enable_disclaimer, "yes");
  assert.equal(s.login_required, "no");
  assert.equal(s.contact_info_required, "no");
  assert.equal(s.thirdparty_type, "17");
  assert.equal(s.thirdparty_id, "Streets / Roadways / Alleys-Pothole");
  for (const k of ["image", "share_options", "sort_order", "disclosure"]) assert.equal(s[k], "", k);
});

test("payload: contact fields go only when the draft is not anonymous, and only the non-empty ones", async () => {
  const contact = { firstName: "Pat", lastName: "", email: "pat@example.com", phone: "" };
  const d = potholeDraft();
  let { issue } = await d.payload(DEVICE, contact);
  assert.equal(issue.first_name, "Pat");
  assert.equal(issue.email, "pat@example.com");
  assert.equal("last_name" in issue, false);
  assert.equal("phone" in issue, false);

  d.anonymous = true;
  ({ issue } = await d.payload(DEVICE, contact));
  for (const k of ["first_name", "last_name", "email", "phone"]) assert.equal(k in issue, false, k);

  // An empty contact adds nothing (Contact.isEmpty in Store.swift).
  d.anonymous = false;
  ({ issue } = await d.payload(DEVICE, { firstName: "", lastName: "", email: "", phone: "" }));
  for (const k of ["first_name", "last_name", "email", "phone"]) assert.equal(k in issue, false, k);
});

test("payload: each photo is a CAM<ms>.jpeg ZIP entry, named as in files_metadata", async () => {
  const d = potholeDraft();
  const a = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const b = new Uint8Array([0xff, 0xd8, 9, 8, 7, 6, 0xff, 0xd9]);
  d.photos = [{ blob: new Blob([a], { type: "image/jpeg" }), url: "blob:a" }, { blob: new Blob([b], { type: "image/jpeg" }), url: "blob:b" }];
  const { issue, zip } = await d.payload(DEVICE, null);
  const now = Number(issue.timestamp);
  const names = [`CAM${now}.jpeg`, `CAM${now + 1}.jpeg`];
  assert.deepEqual(issue.files_metadata.map((m) => m.filename), names);
  for (const m of issue.files_metadata) {
    // "yyyy-MM-dd HH:mm:ss", the phone's local time on a 24-hour clock.
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(m.metadata.creation_date);
    assert.ok(match, m.metadata.creation_date);
    const [, y, mo, da, h, mi, s] = match.map(Number);
    assert.ok(Math.abs(new Date(y, mo - 1, da, h, mi, s).getTime() - now) < 2000, "local time, near the timestamp");
  }
  const entries = await readZip(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual([...entries.keys()], names);
  assert.deepEqual(entries.get(names[0]), a);
  assert.deepEqual(entries.get(names[1]), b);
});

test("payload: no location gives empty RAI_LAT and RAI_LONG and no address fields", async () => {
  const d = potholeDraft();
  d.location = null;
  const { issue } = await d.payload(DEVICE, null);
  assert.equal(issue.RAI_LAT, "");
  assert.equal(issue.RAI_LONG, "");
  for (const k of ["location", "address", "RAI_STREET", "RAI_CITY", "RAI_STATE", "RAI_ZIP"]) assert.equal(k in issue, false, k);
});

test("payload: a Standard type with no sub-types sends no form fields", async () => {
  const d = new Draft("std");
  d.category = new Category({ cat_id: "11099", server_id: "11099", name: "Streetlights", type: "Standard", form_data: "" }, []);
  d.share = "private";
  const { issue } = await d.payload(DEVICE, null);
  assert.equal(issue.type, "Standard");
  assert.equal(issue.subtype, "");
  assert.deepEqual(issue.SELECTED_SUB_TYPE, []);
  assert.equal(issue.share_options, "private");
  assert.equal("form_data" in issue, false);
  assert.equal("new_form_data" in issue, false);
});

test("payload: no category is an error", async () => {
  await assert.rejects(new Draft("none").payload(DEVICE, null), /Pick what is wrong first\./);
});

test("missing names the first thing still needed, in Swift's order", () => {
  const d = new Draft("m");
  assert.equal(d.missing, "Pick what is wrong.");
  d.category = new Category(POTHOLE, [POTHOLE_ALLEY, POTHOLE_STREET]);
  assert.equal(d.missing, "Pick a type.");
  d.sub = POTHOLE_STREET;
  assert.equal(d.missing, "Answer \"Number of Potholes\".");
  d.choiceAnswers["Number of Potholes"] = ["One pothole"];
  assert.equal(d.missing, "Set the location.");
  d.location = { ...LOCATION };
  assert.equal(d.missing, null);
});

test("missing: a required description comes after the location", () => {
  const d = new Draft("m2");
  d.category = new Category({ cat_id: "1", name: "Tents or Sleeping Structures", type: "Standard", location_required: "yes", description_required: "yes" }, []);
  assert.equal(d.missing, "Set the location.");
  d.location = { ...LOCATION };
  assert.equal(d.missing, "Add a description.");
  d.notes = "  \n ";
  assert.equal(d.missing, "Add a description.");
  d.notes = "Two tents by the bridge.";
  assert.equal(d.missing, null);
});

test("missing: a required yes/no question never blocks, and it answers NO", () => {
  const form = JSON.stringify([{ type: 1, caption: "Is the light out?", sort_order: 1, IS_INPUT_REQUIRED: "yes" }]);
  const d = new Draft("m3");
  d.category = new Category({ cat_id: "2", name: "Streetlights", type: "form_type", form_data: form, location_required: "no" }, []);
  assert.equal(d.missing, null);
  assert.equal(d.answer(d.questions[0]), "NO");
  d.answers["Is the light out?"] = "YES";
  assert.equal(d.answer(d.questions[0]), "YES");
});

test("missing: a non-empty answer must pass the question's regex, as a partial match (docs/API.md 7.3)", () => {
  const form = JSON.stringify([{ type: 3, caption: "Pole number", sort_order: 1, IS_INPUT_REQUIRED: "no", regex: "\\d{5}" }]);
  const d = new Draft("m4");
  d.category = new Category({ cat_id: "3", name: "Streetlights", type: "form_type", form_data: form }, []);
  assert.equal(d.missing, null, "an empty optional answer is not checked");
  d.answers["Pole number"] = "pole 12";
  assert.equal(d.missing, "Check \"Pole number\".");
  d.answers["Pole number"] = "pole 12345";
  assert.equal(d.missing, null);
});
