// The note-with-photos parts sent to add_comments_citizen (docs/API.md section 8).
import assert from "node:assert/strict";
import { test } from "node:test";
import { zipStore } from "../../public/js/lib/zip.js";
import { noteFields, photoNames } from "../../worker/notes.js";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const zipOf = async (names) => new Uint8Array(await zipStore(names.map((name) => ({ name, data: jpeg }))).arrayBuffer());

test("photoNames reads the CAM entry names from the app's zip", async () => {
  assert.deepEqual(await photoNames(await zipOf(["CAM1791232365000.jpeg", "CAM1791232365001.jpeg"])), ["CAM1791232365000.jpeg", "CAM1791232365001.jpeg"]);
});

test("photoNames refuses a zip with other names, repeats, too many photos, or no zip", async () => {
  await assert.rejects(photoNames(await zipOf(["notes.txt"])), { code: "bad_zip" });
  await assert.rejects(photoNames(await zipOf(["../CAM1791232365000.jpeg"])), { code: "bad_zip" });
  await assert.rejects(photoNames(await zipOf(["CAM1791232365000.jpeg", "CAM1791232365000.jpeg"])), { code: "bad_zip" });
  await assert.rejects(photoNames(await zipOf([0, 1, 2, 3, 4].map((i) => `CAM179123236500${i}.jpeg`))), { code: "too_many" });
  await assert.rejects(photoNames(new Uint8Array([1, 2, 3])), { code: "bad_zip" });
});

test("noteFields: text alone has no attachments part", () => {
  const f = noteFields("city", "9000001", "Still there.", [], 1791232365000);
  assert.deepEqual(Object.keys(f), ["issue_id", "notes", "city_id", "notify", "api_version", "notifyids", "offline_timestamp"]);
  assert.equal(f.offline_timestamp, "1791232365000");
});

test("noteFields: photos give a bracketed list with no quotes, as the official app sends it", () => {
  const f = noteFields("city", "9000001", "", ["CAM1.jpeg", "CAM2.jpeg"], 5);
  assert.equal(f.notes, "");
  assert.equal(f.attachments, "[CAM1.jpeg,CAM2.jpeg]");
  assert.deepEqual(Object.keys(f), ["issue_id", "notes", "city_id", "notify", "api_version", "notifyids", "attachments", "offline_timestamp"]);
});
