// One report as the user builds it. payload() turns it into the
// `issue_details` JSON and photo ZIP the official app sends (docs/API.md,
// section 3). Ported from ReportDraft.swift. A draft is saved to IndexedDB
// as it changes, so a reload (iOS can drop a web app while the camera is
// open) does not lose it.

import { idb } from "./lib/store.js";
import { preparePhoto } from "./lib/image.js";
import { zipStore } from "./lib/zip.js";
import { Kind, MENU_REPORT, stripHTML, str, subId, subName } from "./models.js";
import { address, answerFor, facts, factsLine } from "./place.js";

export const KANSAS_CITY = "1adb57d07d9ea1e1dd8160697f745c0d";
const SUB_KEYS = ["category_id", "name", "cat_order", "type", "menu_id", "server_id", "autoresponse_text", "login_required",
  "disclaimer_phone", "disclaimer_text", "disclaimer_title", "disclaimer_url", "enable_disclaimer", "form_data",
  "contact_info_required", "thirdparty_type", "thirdparty_id"];

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** The city's answer format for date and time questions. */
export function formatAnswerDate(kind, d) {
  const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return kind === Kind.date ? date : kind === Kind.time ? time : `${date} ${time}`;
}

export class Draft {
  constructor(key) {
    this.key = key;
    this.clear();
  }

  clear() {
    for (const p of this.photos || []) URL.revokeObjectURL(p.url);
    this.photos = [];          // [{ blob, url }]
    this.category = null;
    this.sub = null;
    this.answers = {};         // caption → text
    this.choiceAnswers = {};   // caption → [option ids]
    this.autoAnswers = {};
    this.notes = "";
    this.location = null;      // { lat, lng, street, city, state, zip }
    this.locationSource = "phone GPS";
    this.place = null;
    this.anonymous = false;
    this.share = "public";     // the city's own default is "private"
  }

  reset() {
    this.clear();
    this.save();
  }

  setCategory(cat, sub) {
    this.category = cat;
    this.sub = sub || null;
    this.answers = {};
    this.choiceAnswers = {};
    this.autoAnswers = {};
    this.fillWhere();
    this.save();
  }

  get questions() { return this.category ? this.category.questions(this.sub) : []; }
  get locationRequired() { return this.category?.value("location_required", this.sub) === "yes"; }
  get descriptionRequired() { return this.category?.value("description_required", this.sub) === "yes"; }

  get disclaimer() {
    const c = this.category;
    if (!c || c.value("enable_disclaimer", this.sub) !== "yes") return null;
    return stripHTML(c.value("disclaimer_text", this.sub)) || null;
  }

  get autoresponse() { return stripHTML(this.category?.value("autoresponse_text", this.sub) || "") || null; }
  get title() { return [this.category?.name, this.sub ? str(this.sub, "name") : null].filter(Boolean).join(": "); }
  get label() { return this.sub ? subName(this.sub) : this.category?.displayName || ""; }

  answer(q) {
    if (q.kind === Kind.choice) {
      const picked = new Set(this.choiceAnswers[q.caption] || []);
      return q.options.filter((o) => picked.has(o.id)).map((o) => o.id).join(",");
    }
    if (q.kind === Kind.yesNo) return this.answers[q.caption] === "YES" ? "YES" : "NO";
    return this.answers[q.caption] || "";
  }

  /** The first thing still missing, or null when the draft can be sent. */
  get missing() {
    if (!this.category) return "Pick what is wrong.";
    if (this.category.subs.length && !this.sub) return "Pick a type.";
    for (const q of this.questions) {
      if (q.required && q.kind !== Kind.yesNo && !this.answer(q)) return `Answer "${q.caption}".`;
      if (q.regex && this.answer(q)) {
        try { if (!new RegExp(q.regex).test(this.answer(q))) return `Check "${q.caption}".`; } catch { /* a Java-only pattern */ }
      }
    }
    if (this.locationRequired && !this.location) return "Set the location.";
    if (this.descriptionRequired && !this.notes.trim()) return "Add a description.";
    return null;
  }

  /** Adds a photo. A photo with EXIF GPS sets the location, unless the pin was placed by hand. */
  async addPhoto(file) {
    const { blob, gps } = await preparePhoto(file);
    this.photos.push({ blob, url: URL.createObjectURL(blob) });
    if (gps && this.locationSource !== "pin placed by hand") {
      this.locationSource = "photo GPS";
      this.location = await address(gps);
    }
    this.save();
  }

  removePhoto(i) {
    const [p] = this.photos.splice(i, 1);
    if (p) URL.revokeObjectURL(p.url);
    this.save();
  }

  async setLocation(pt, source) {
    this.locationSource = source;
    this.location = pt.street ? pt : await address(pt);
    this.save();
  }

  /**
   * Looks up the address and intersection for the location, then writes them
   * into the description and into questions that ask where. Only text this
   * method wrote before is replaced; typed text stays.
   */
  async refreshPlace() {
    const loc = this.location;
    if (!loc) return;
    const f = await facts(loc, this.locationSource);
    if (this.location !== loc) return;
    this.place = f;
    const kept = this.notes.split("\n").filter((l) => !l.startsWith("Location: GPS"));
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    this.notes = [...kept, ...(kept.length ? [""] : []), factsLine(f)].join("\n");
    this.fillWhere();
    this.save();
  }

  fillWhere() {
    if (!this.place) return;
    for (const q of this.questions) {
      if (q.kind !== Kind.text) continue;
      const fill = answerFor(this.place, q.caption);
      if (!fill) continue;
      const now = this.answers[q.caption] || "";
      if (!now || now === this.autoAnswers[q.caption]) {
        this.answers[q.caption] = fill;
        this.autoAnswers[q.caption] = fill;
      }
    }
  }

  /** The issue_details object and the photo ZIP (or null). */
  async payload(deviceUID, contact, cityId = KANSAS_CITY) {
    const cat = this.category;
    if (!cat) throw new Error("Pick what is wrong first.");
    const now = Date.now();
    const entries = [];
    const meta = [];
    for (const [i, p] of this.photos.entries()) {
      const name = `CAM${now + i}.jpeg`;
      entries.push({ name, data: new Uint8Array(await p.blob.arrayBuffer()) });
      meta.push({ filename: name, metadata: { creation_date: stamp(new Date()) } });
    }
    const type = cat.effectiveType(this.sub);
    const loc = this.location;
    const issue = {
      city_id: cityId, menu_id: MENU_REPORT, timestamp: String(now),
      deviceuid: deviceUID, device_id: deviceUID,
      type, type_id: cat.id, name: cat.name, issue_cat_id: cat.flag("server_id"),
      subtype: this.sub ? str(this.sub, "name") : "",
      SELECTED_SUB_TYPE: this.sub ? [selected(this.sub)] : [],
      notes: this.notes, share_options: this.share, files_metadata: meta,
      RAI_LAT: loc ? loc.lat : "", RAI_LONG: loc ? loc.lng : "",
      api_version: "6.0", offline_timestamp: now,
    };
    if (contact && !this.anonymous) {
      for (const [k, v] of [["first_name", contact.firstName], ["last_name", contact.lastName], ["email", contact.email], ["phone", contact.phone]]) {
        if (v && v.trim()) issue[k] = v.trim();
      }
    }
    if (loc) Object.assign(issue, { location: loc.street, address: loc.street, RAI_STREET: loc.street, RAI_CITY: loc.city, RAI_STATE: loc.state, RAI_ZIP: loc.zip });
    if (["form_type", "form_type_car"].includes(type.toLowerCase()) && this.questions.length) {
      const form = {};
      const list = [];
      for (const q of this.questions) {
        const a = this.answer(q);
        form[q.caption] = a;
        list.push({ caption: q.caption, type: q.kind, sort_order: q.sortOrder, enterdValue: a });
      }
      issue.form_data = form;
      issue.new_form_data = list;
    }
    return { issue, zip: entries.length ? zipStore(entries) : null };
  }

  // ---------- saved copy ----------

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      idb.set(`draft:${this.key}`, {
        cat: this.category?.id || null, sub: this.sub ? subId(this.sub) : null,
        photos: this.photos.map((p) => p.blob), answers: this.answers, choiceAnswers: this.choiceAnswers,
        autoAnswers: this.autoAnswers, notes: this.notes, location: this.location, locationSource: this.locationSource,
        place: this.place, anonymous: this.anonymous, share: this.share, at: Date.now(),
      });
    }, 300);
  }

  /** Loads the saved copy (younger than a day), linking the category against the loaded catalog. */
  async restore(categories) {
    const s = await idb.get(`draft:${this.key}`);
    if (!s || Date.now() - (s.at || 0) > 86400000) return false;
    this.photos = (s.photos || []).map((blob) => ({ blob, url: URL.createObjectURL(blob) }));
    this.category = categories.find((c) => c.id === s.cat) || null;
    this.sub = this.category?.subs.find((x) => subId(x) === s.sub) || null;
    Object.assign(this, {
      answers: s.answers || {}, choiceAnswers: s.choiceAnswers || {}, autoAnswers: s.autoAnswers || {}, notes: s.notes || "",
      location: s.location || null, locationSource: s.locationSource || "phone GPS", place: s.place || null,
      anonymous: !!s.anonymous, share: s.share || "public",
    });
    return true;
  }
}

function selected(s) {
  const o = {};
  for (const k of SUB_KEYS) o[k] = str(s, k);
  o.Id = subId(s);
  o.subCat_id = subId(s);
  for (const k of ["image", "share_options", "sort_order", "disclosure"]) o[k] = "";
  return o;
}
