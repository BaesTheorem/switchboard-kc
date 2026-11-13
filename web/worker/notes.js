// Notes and photos on one of this id's reports (add_comments_citizen,
// docs/API.md section 8). The official app sends the text and the photos as
// two calls: the text with no photos, then each batch of photos with an
// empty `notes` (RAIReportDetailActivity.call_submitApi). This server does
// the same, so a note with photos makes two entries in the report history.

import { readZip } from "../public/js/lib/zip.js";
import { API_VERSION, civicJSON, getConfig } from "./civic.js";
import { HttpError } from "./util.js";

export const MAX_NOTE_PHOTOS = 4;
const PHOTO_NAME = /^CAM\d{10,16}\.jpeg$/;

/**
 * The entry names of a photo ZIP from the app, checked: 1 to 4 entries,
 * each `CAM<ms>.jpeg`, no repeats. The city reads the names from the
 * `attachments` part, so this server makes that part from the ZIP itself.
 */
export async function photoNames(buf) {
  const names = [];
  try {
    await readZip(buf, (n) => (names.push(n), false));
  } catch {
    throw new HttpError(400, "bad_zip", "The photos are not a zip file.");
  }
  if (!names.length) throw new HttpError(400, "bad_zip", "The zip file has no photos.");
  if (names.length > MAX_NOTE_PHOTOS) throw new HttpError(413, "too_many", `Add at most ${MAX_NOTE_PHOTOS} photos to one note.`);
  if (new Set(names).size !== names.length || !names.every((n) => PHOTO_NAME.test(n))) {
    throw new HttpError(400, "bad_zip", "The photo names in the zip file are not valid.");
  }
  return names;
}

/** The parts of one add_comments_citizen call, in the order the official app sends them. */
export function noteFields(cityId, id, notes, names = [], now = Date.now()) {
  const f = { issue_id: id, notes, city_id: cityId, notify: "", api_version: API_VERSION, notifyids: "" };
  if (names.length) f.attachments = `[${names.join(",")}]`;
  f.offline_timestamp = String(now);
  return f;
}

async function call(env, uid, cfg, id, notes, photos) {
  const files = photos ? [{ name: "file_zip", blob: photos.blob, filename: `${Date.now()}_images.zip` }] : [];
  const o = await civicJSON(env, uid, "add_comments_citizen", noteFields(cfg.city_id, id, notes, photos?.names), files);
  const msg = String(o.response_message || "");
  if (!/success/i.test(msg)) throw new HttpError(422, "note_refused", msg || "The city did not take the note.");
  const issue = Array.isArray(o.response_data) ? o.response_data[0] : null;
  if (issue) for (const k of Object.keys(issue)) if (k.startsWith("reporter_")) delete issue[k];
  return issue;
}

/**
 * Adds a note, photos, or both to one of this id's reports. The city ties
 * the note to the device id in the signature, so it refuses reports this id
 * did not file. Returns the updated report, contact fields removed.
 * `photos` is `{ blob, names }` or null.
 */
export async function addNote(env, uid, id, notes, photos = null) {
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  let issue = null;
  if (notes) issue = await call(env, uid, cfg, id, notes, null);
  if (photos) {
    try {
      issue = (await call(env, uid, cfg, id, "", photos)) || issue;
    } catch (e) {
      if (!notes) throw e;
      throw new HttpError(e.status || 502, "photos_refused", `The note went to the city, but the photos did not. ${e.message}`);
    }
  }
  return issue;
}
