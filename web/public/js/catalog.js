// The city's 41 categories overlap (three for trash, three for water, four
// for traffic), so the app groups them into plain sections. Each section also
// holds the city pages that belong with it. A category the table does not
// know (the city adds one) lands in "Other". Ported from Sections.swift.

import { isUpdateRequestName, linkIcon, linkName, subId, subName } from "./models.js";

export const SECTIONS = [
  { id: "trash", title: "Trash & Recycling", icon: "delete",
    blurb: "Missed pickups, carts, blue bags, bulky items, leaves, dumping",
    categoryKeys: ["trash", "recycling cart", "solid waste", "leaf and brush", "illegal dumping"],
    linkKeys: ["bulky", "holiday trash", "recycling cart", "leaf and brush", "snow and trash"] },
  { id: "streets", title: "Streets & Sidewalks", icon: "road",
    blurb: "Potholes, pavement, curbs, sidewalks, sweeping, snow, bridges, graffiti",
    categoryKeys: ["pothole", "street maintenance", "sidewalks", "street cleaning", "bridge", "right-of-way", "snow", "graffiti"],
    linkKeys: ["street preservation", "snowplow", "snow and trash"] },
  { id: "traffic", title: "Traffic, Parking & Lights", icon: "traffic",
    blurb: "Signals, signs, markings, streetlights, speeding, bike lanes, parking, towing",
    categoryKeys: ["traffic", "streetlight", "vision zero", "bike", "vehicles and parking", "parking meter"], linkKeys: [] },
  { id: "water", title: "Water & Sewer", icon: "water_drop",
    blurb: "Leaks, main breaks, pressure, water quality, sewer backups, storm drains",
    categoryKeys: ["water", "sewer"], linkKeys: ["kc water"] },
  { id: "property", title: "Property & Housing", icon: "home",
    blurb: "Weeds, junk, vacant or open buildings, rentals, short-term rentals, zoning, tents",
    categoryKeys: ["property violations", "healthy homes", "land bank", "short term rental", "zoning", "tents"], linkKeys: [] },
  { id: "parks", title: "Parks & Trees", icon: "park",
    blurb: "Park upkeep, playgrounds, fountains, reservations, trees in the right-of-way",
    categoryKeys: ["parks", "trees"], linkKeys: [] },
  { id: "animals", title: "Animals", icon: "pets",
    blurb: "Strays, bites, cruelty, dead animals, wildlife", categoryKeys: ["animal"], linkKeys: [] },
  { id: "safety", title: "Health & Safety", icon: "health_and_safety",
    blurb: "Food safety, health code, police and fire requests, hate incidents",
    categoryKeys: ["public safety", "health code", "food safety", "hate"],
    linkKeys: ["health dept", "coronavirus", "police report", "fountain id"] },
  { id: "rights", title: "Rights, Labor & Business", icon: "balance",
    blurb: "Discrimination, wage theft, contractor complaints, business help",
    categoryKeys: ["discrimination", "contract and labor"], linkKeys: ["bizcare", "language access"] },
];

export const OTHER = { id: "other", title: "Other", icon: "more_horiz", blurb: "Report types the app does not group yet", categoryKeys: [], linkKeys: [] };

const owns = (sec, name) => sec.categoryKeys.some((k) => name.toLowerCase().includes(k));
const ownsLink = (sec, link) => sec.linkKeys.some((k) => link.name.toLowerCase().includes(k));

/** Section for a category; the first match wins. */
export const sectionOf = (cat) => SECTIONS.find((s) => owns(s, cat.name)) || OTHER;
export const sectionById = (id) => SECTIONS.find((s) => s.id === id) || OTHER;

export const reportCategories = (cats) => cats.filter((c) => !isUpdateRequestName(c.name));
export const updateCategory = (cats) => cats.find((c) => isUpdateRequestName(c.name));
export const categoriesIn = (cats, sec) => reportCategories(cats).filter((c) => sectionOf(c).id === sec.id);
export const linksIn = (links, sec) => links.filter((l) => ownsLink(sec, l));
/** Links that no section claims stay on the City tab. */
export const generalLinks = (links) => links.filter((l) => !SECTIONS.some((s) => ownsLink(s, l)));
export const sectionsFor = (cats) => [...SECTIONS, ...(reportCategories(cats).some((c) => sectionOf(c) === OTHER) ? [OTHER] : [])];

// ---------- phone numbers ----------

// 311 and police from kcpolice.org; streetcar from kcstreetcar.org; the rest
// from the city's own 311 catalog text, where each number appears next to the
// service it reaches (checked 2026-10-05).
export const PHONES_PINNED = [
  { name: "Call 311", number: "816-513-1313" },
  { name: "Police non-emergency", number: "816-234-5111" },
  { name: "KC Streetcar Authority", number: "816-627-2527" },
  { name: "KC Streetcar See Say (text dispatch)", number: "816-837-4800", text: true },
];

export const PHONES_MORE = [
  { name: "Animal bite, after hours", number: "816-788-0725" },
  { name: "Barking dogs (KC Pet Project)", number: "816-683-1373" },
  { name: "Beekeeper registration", number: "816-513-6048" },
  { name: "Civil Rights and Equal Opportunity", number: "816-513-1836" },
  { name: "Crosswalk Restoration Program", number: "816-513-9870" },
  { name: "Environmental compliance, illicit discharge", number: "816-513-0600" },
  { name: "Fire appearances and station tours", number: "816-513-6464" },
  { name: "Fire Marshal, smoke detectors", number: "816-513-4648" },
  { name: "Food handler cards (Health Department)", number: "816-513-6315" },
  { name: "HUD housing discrimination", number: "800-669-9777" },
  { name: "Human trafficking hotline", number: "888-373-7888" },
  { name: "KC Water, account shut off", number: "816-513-0567" },
  { name: "KC Water, lead service line hotline", number: "816-513-0150" },
  { name: "KCPD community complaints", number: "816-889-6640" },
  { name: "KCPD information", number: "816-234-5000" },
  { name: "KCPD records", number: "816-234-5100" },
  { name: "KCPD video requests", number: "816-234-5589" },
  { name: "MoDOT (highways and ramps)", number: "816-607-2000" },
  { name: "Parks facility reservations", number: "816-513-0632" },
  { name: "PIAC sidewalk requests", number: "816-513-8828" },
  { name: "Regulated industries licenses", number: "816-513-4560" },
  { name: "Towed vehicles, reclaim", number: "816-513-0668" },
  { name: "Tow lot (7750 E Front St)", number: "816-513-0688" },
  { name: "Traffic calming", number: "816-513-9886" },
  { name: "Wildlife (Lakeside Nature Center)", number: "816-513-8960" },
];

export const phoneHref = (p) => `${p.text ? "sms" : "tel"}:${p.number.replace(/\D/g, "")}`;

/**
 * Every report type, page, and phone number, for the A to Z list. Each item:
 * { title, detail, icon, kind: "report"|"link"|"phone"|"streetcar", cat?, sub?, link?, phone? }.
 */
export function directory(cats, links) {
  const out = [];
  for (const c of reportCategories(cats)) {
    const section = sectionOf(c).title;
    if (!c.subs.length) out.push({ title: c.displayName, detail: section, icon: c.icon, kind: "report", cat: c, sub: null });
    for (const s of c.subs) out.push({ title: subName(s), detail: `${c.displayName} · ${section}`, icon: c.icon, kind: "report", cat: c, sub: s });
  }
  for (const l of links) {
    const where = SECTIONS.find((s) => ownsLink(s, l))?.title || "City";
    out.push({ title: linkName(l.name), detail: `Web page · ${where}`, icon: linkIcon(l.name), kind: "link", link: l });
  }
  for (const p of [...PHONES_PINNED, ...PHONES_MORE]) out.push({ title: p.name, detail: p.number, icon: p.text ? "sms" : "call", kind: "phone", phone: p });
  out.push({ title: "KC Streetcar problem", detail: "Streetcar Authority, not 311", icon: "tram", kind: "streetcar" });
  return out.sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
}

/** A stable key for a directory item, used in links (#/services/form/<cat>/<sub>). */
export const itemKey = (it) => (it.kind === "report" ? `${it.cat.id}/${it.sub ? subId(it.sub) : ""}` : it.title);
