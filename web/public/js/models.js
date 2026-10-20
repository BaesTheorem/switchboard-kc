// The city's records, read into plain objects. The API mixes numbers and
// strings for the same field, so every read goes through str()/num().
// Ported from ios/KC311/Sources/Models.swift; the rules there apply here.

export const UPDATE_TEXT = "Please send an update on";
export const MENU_REPORT = "10871";

export const str = (d, k) => {
  const v = d?.[k];
  // A JSON boolean reads as "1"/"0", as NSNumber.stringValue does in the iPhone app.
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : typeof v === "boolean" ? (v ? "1" : "0") : "";
};
export const num = (d, k) => {
  const s = str(d, k);
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
/** Epoch seconds as a Date, or null for 0 / missing. */
export const epoch = (d, k) => {
  const t = num(d, k);
  return t && t > 0 ? new Date(t * 1000) : null;
};

/** The city strips commas from some names ("Trash  Recycling  Bulky Services"); show the double space as a comma. */
export const cleanName = (s) => String(s || "").replace(/\s{2,}/g, ", ").trim();

export function stripHTML(s) {
  // &amp; goes last, so "&amp;lt;" stays the text "&lt;" (Swift decodes it once).
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
}

/** The city's 311 case number. It exists only after the report syncs to the city's CRM. */
export function cityCaseNumber(d) {
  let tp = d?.thirdparty_params;
  if (typeof tp === "string") { try { tp = tp ? JSON.parse(tp) : null; } catch { tp = null; } }
  return tp && typeof tp === "object" && tp.case_number ? String(tp.case_number) : "";
}

const httpsOnly = (list) => (Array.isArray(list) ? list : []).map(String).filter((u) => /^https:\/\//i.test(u));

// ---------- questions ----------

export const Kind = { yesNo: 1, monthYear: 2, text: 3, choice: 4, dateTime: 5, date: 6, time: 7 };

export function parseQuestions(raw) {
  if (!raw) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((d) => {
      const kind = Number(str(d, "type"));
      if (!Object.values(Kind).includes(kind)) return null;
      return {
        caption: str(d, "caption"),
        kind,
        placeholder: str(d, "placeholder") || str(d, "Placeholder"),
        required: ["yes", "1"].includes(str(d, "IS_INPUT_REQUIRED").toLowerCase()),
        multiple: str(d, "allow_multiple_select") === "yes",
        options: (Array.isArray(d.dropdown_options) ? d.dropdown_options : []).map((o) => ({ id: str(o, "id"), value: str(o, "value") })),
        sortOrder: Number(str(d, "sort_order")) || 0,
        regex: str(d, "regex"),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------- catalog ----------

/** A category with its sub-types. A sub-type's value wins over its category's, as in the official app. */
export class Category {
  constructor(row, subs) {
    this.row = row;
    this.subs = subs;
  }
  get id() { return str(this.row, "cat_id"); }
  get name() { return str(this.row, "name"); }
  get displayName() { return cleanName(this.name); }
  get icon() { return categoryIcon(this.name); }
  flag(key) { return str(this.row, key); }
  value(key, sub) {
    const s = sub ? str(sub, key) : "";
    return s !== "" ? s : str(this.row, key);
  }
  questions(sub) {
    if (sub && str(sub, "form_data") && str(sub, "type")) return parseQuestions(str(sub, "form_data"));
    return parseQuestions(str(this.row, "form_data"));
  }
  effectiveType(sub) {
    if (sub && str(sub, "type")) return str(sub, "type");
    return str(this.row, "type") || "Standard";
  }
}

export const subId = (s) => str(s, "subcat_id") || str(s, "cat_id");
export const subName = (s) => cleanName(str(s, "name"));

/** Categories, sorted, each with its sub-types, from the trimmed get_main tables. */
export function readCatalog(tables) {
  const subs = tables.RAI_SUBCATEGORY || [];
  const categories = [...(tables.RAI_CATEGORY || [])]
    .sort((a, b) => (Number(str(a, "sort_order")) || 0) - (Number(str(b, "sort_order")) || 0))
    .map((cat) => new Category(cat, subs
      .filter((s) => str(s, "category_id") === str(cat, "cat_id"))
      .sort((a, b) => (Number(str(a, "cat_order")) || 0) - (Number(str(b, "cat_order")) || 0))))
    .filter((c) => c.flag("no_entry") !== "yes");
  const links = (tables.MENU || [])
    .map((r) => {
      const url = (str(r, "ios_url") || str(r, "menu_item_url")).trim();
      return /^https?:\/\//i.test(url) ? { name: str(r, "menu_item_name"), url } : null;
    })
    .filter(Boolean);
  return { categories, links };
}

const CATEGORY_ICONS = [
  ["pothole", "road"], ["street light", "lightbulb"], ["streetlight", "lightbulb"], ["traffic", "traffic"],
  ["sign", "signpost"], ["trash", "delete"], ["recycl", "recycling"], ["dump", "delete_sweep"],
  ["bulky", "chair"], ["animal", "pets"], ["tree", "park"], ["park", "park"], ["water", "water_drop"],
  ["sewer", "plumbing"], ["storm", "flood"], ["snow", "ac_unit"], ["graffiti", "format_paint"],
  ["sidewalk", "directions_walk"], ["bike", "pedal_bike"], ["bridge", "architecture"], ["vehicle", "directions_car"],
  ["car", "directions_car"], ["parking", "local_parking"], ["noise", "volume_up"], ["weed", "grass"],
  ["grass", "grass"], ["property", "home"], ["house", "home"], ["building", "apartment"],
  ["tent", "camping"], ["sleep", "camping"], ["discrimination", "balance"], ["curb", "road"],
  ["alley", "road"], ["bus", "directions_bus"], ["health", "health_and_safety"], ["rodent", "pest_control"],
  ["mosquito", "pest_control"], ["light", "lightbulb"], ["update", "update"], ["street", "road"],
];
export const CATEGORY_ICON_NAMES = [...new Set(CATEGORY_ICONS.map((x) => x[1])), "report"];

export function categoryIcon(name) {
  const n = String(name || "").toLowerCase();
  return CATEGORY_ICONS.find(([k]) => n.includes(k))?.[1] || "report";
}

const LINK_ICONS = [
  ["court", "gavel"], ["calendar", "calendar_month"], ["water", "water_drop"], ["health", "health_and_safety"],
  ["vaccine", "vaccines"], ["official", "groups"], ["hear", "campaign"], ["pay", "payments"],
  ["biz", "storefront"], ["snow", "ac_unit"], ["trash", "delete"], ["kudos", "thumb_up"],
  ["street", "road"], ["job", "work"], ["bulky", "chair"], ["leaf", "eco"], ["recycl", "recycling"],
  ["parade", "celebration"], ["fountain", "badge"], ["police", "local_police"], ["speak", "forum"],
  ["plow", "map"], ["ask", "support_agent"], ["sunshine", "description"], ["language", "translate"],
  ["compass", "explore"],
];
export const LINK_ICON_NAMES = [...new Set(LINK_ICONS.map((x) => x[1])), "open_in_new"];

export function linkIcon(name) {
  const n = String(name || "").toLowerCase();
  return LINK_ICONS.find(([k]) => n.includes(k))?.[1] || "open_in_new";
}

/** Clearer labels for the city's menu names where the name hides the action. */
export function linkName(name) {
  return {
    "Bulky Item Pickup": "Schedule a bulky item pickup",
    "Recycling Carts": "Recycling cart information",
    "Leaf and Brush": "Leaf and brush pickup schedule",
    "Snowplow Map": "Snowplow map",
    "Snow and Trash Update": "Snow and trash service updates",
    "Make a Police Report": "Make a police report online",
  }[name] || name;
}

// ---------- reports ----------

const UTC_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
function utcString(s) {
  const m = UTC_RE.exec(String(s || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}
function mdy(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ""));
  return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2])) : null;
}

export const isUpdateRequestName = (name) => String(name || "").toLowerCase().includes("request update");

/**
 * One row of "my reports" (myissues). Here `category` holds the form type, so
 * the category name comes from `name` / `issue_type`. myissues' epoch fields run
 * hours ahead of the real time; `updated_on`, a UTC string, is right. Filing
 * time is the earlier of the two, never later than now.
 */
export function myReport(d, now = Date.now()) {
  const updatedOn = utcString(str(d, "updated_on"));
  const addedCandidates = [epoch(d, "added_on"), updatedOn].filter(Boolean).map((x) => x.getTime());
  const added = addedCandidates.length ? new Date(Math.min(...addedCandidates, now)) : null;
  const moves = [added, updatedOn, mdy(str(d, "last_action_date"))].filter(Boolean).map((x) => x.getTime());
  const r = {
    id: str(d, "id"),
    caseNumber: cityCaseNumber(d),
    category: cleanName(str(d, "name") || str(d, "issue_type")),
    subcategory: cleanName(str(d, "subcategory") || str(d, "sub_type")),
    status: str(d, "status"),
    description: str(d, "description"),
    address: str(d, "address"),
    unread: Number(str(d, "new_update_count")) || 0,
    lat: num(d, "latitude"),
    lng: num(d, "longitude"),
    added,
    lastMovement: moves.length ? new Date(Math.min(Math.max(...moves), now)) : null,
  };
  r.label = r.subcategory || r.category;
  r.isUpdateRequest = isUpdateRequestName(r.category) || r.description.trim().startsWith(UPDATE_TEXT);
  r.isOpen = stage(r.status) !== 3;
  return r;
}

/** Detail of one report. Reporter contact fields are never read. */
export function reportDetail(d) {
  const hist = [...(Array.isArray(d.history_object) ? d.history_object : [])]
    .sort((a, b) => (num(a, "timestamp") || 0) - (num(b, "timestamp") || 0));
  return {
    caseNumber: cityCaseNumber(d),
    status: str(d, "status"),
    type: cleanName(str(d, "type")),
    subtype: cleanName(str(d, "subtype")),
    address: str(d, "address"),
    description: str(d, "description"),
    photos: httpsOnly(d.issue_image),
    added: epoch(d, "added_on"),
    timeline: hist.map((h) => ({ title: str(h, "title"), details: stripHTML(str(h, "details")), when: str(h, "dateofupdate"), at: epoch(h, "timestamp") })),
  };
}

/** A public report on the map. */
export function mapIssue(d) {
  const lat = num(d, "issue_latitude"), lng = num(d, "issue_longitude");
  if (lat == null || lng == null) return null;
  return {
    id: str(d, "report_id"),
    type: cleanName(str(d, "issue_name")),
    subtype: cleanName(str(d, "subtype")),
    status: str(d, "issue_status"),
    address: str(d, "issue_address"),
    lat, lng,
    submitted: epoch(d, "issue_submitted_date")?.getTime() || null,
    updated: epoch(d, "issue_lastupdated_date")?.getTime() || null,
    details: stripHTML(str(d, "issue_description")),
    caseNumber: cityCaseNumber(d),
  };
}

// ---------- status ----------

export const STAGES = ["Sent", "Received", "In progress", "Done"];

/**
 * MyCivic statuses: "new" when filed, "received" once staff take it,
 * "assigned" or "referred" while a crew has it, then "resolved" or "canceled".
 * Departments that work a report inside MyCivic record site visits as staff
 * notes and leave the status at "received"; a staff note on an open report
 * counts as work in progress.
 */
export function stage(status, timeline = []) {
  const s = String(status || "").toLowerCase();
  let st = 0;
  if (["resolved", "closed", "canceled", "cancelled", "completed"].some((w) => s.includes(w))) st = 3;
  else if (["assigned", "referred", "active", "progress", "scheduled"].some((w) => s.includes(w))) st = 2;
  else if (s.includes("received")) st = 1;
  if (st < 2 && timeline.some((e) => /staff/i.test(e.title))) st = 2;
  return st;
}
