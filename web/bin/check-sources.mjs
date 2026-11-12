#!/usr/bin/env node
// The Police report screen and the Pay screen hold copies of two public pages
// (public/js/police.js, public/js/pay.js). This reads the pages again and says
// what changed, so a person can update the copies. It changes nothing.
//   node bin/check-sources.mjs
// Both sites refuse a plain request, so this uses a real Chrome when it finds
// one (kcmo.gov refuses the bundled browser), headless, one page each.

import { chromium } from "@playwright/test";
import { PAYMENTS, PAY_PAGE } from "../public/js/pay.js";
import { POLICE_PAGE, POLICE_TYPES, policeFormUrl } from "../public/js/police.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch());
const ctx = await browser.newContext({ userAgent: UA, locale: "en-US" });
let differences = 0;
const say = (line) => { differences++; console.log("  DIFFERENT:", line); };

async function links(url) {
  const page = await ctx.newPage();
  try {
    const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    for (let i = 0; i < 20 && /just a moment/i.test(await page.title()); i++) await page.waitForTimeout(1500);
    await page.waitForTimeout(2000);
    if (!r || r.status() >= 400 || /access denied|just a moment/i.test(await page.title())) return null;
    return await page.evaluate(() => [...(document.querySelector("main, #main, [role=main], .main-content, article, #content") || document.body).querySelectorAll("a[href]")].map((a) => a.href));
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

console.log("Police report types:", POLICE_PAGE);
const police = await links(POLICE_PAGE);
if (!police) say("could not read the page. Read it by hand.");
else {
  const onPage = new Set(police.map((h) => /\/dors\/startreport\/300005194\/(\d+)$/.exec(h)?.[1]).filter(Boolean).map(Number));
  const ours = new Set(POLICE_TYPES.filter((t) => t.form).map((t) => t.form));
  for (const id of onPage) if (!ours.has(id)) say(`the page has a form that the app does not: ${id}`);
  for (const t of POLICE_TYPES) {
    if (t.form && !onPage.has(t.form)) say(`the app has "${t.name}" (${t.form}), and the page does not`);
    if (!t.form && !police.includes(policeFormUrl(t))) say(`the page no longer links to ${policeFormUrl(t)} ("${t.name}")`);
  }
  if (!differences) console.log(`  the same: ${ours.size} forms and the traffic complaint page`);
}

const before = differences;
console.log("Payments:", PAY_PAGE);
const pay = await links(PAY_PAGE);
if (!pay) say("could not read the page (it refuses most automated reads). Read it by hand.");
else {
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const pageHosts = new Set(pay.map(host));
  // The app links to the Compass KC portal, and the city's page links to a page about it.
  for (const p of PAYMENTS) if (!pageHosts.has(host(p.url)) && !/compasskc|parkkcmo/.test(p.url)) say(`the page no longer links to ${host(p.url)} ("${p.name}")`);
  // Not payment sites: the city's own pages, and the page's share and accessibility tools.
  const known = new Set([...PAYMENTS.map((p) => host(p.url)), "kcmo.gov", "city.kcmo.org", "",
    "accessibe.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com", "linkedin.com", "nextdoor.com", "localizejs.com"]);
  for (const h of pageHosts) if (!known.has(h)) say(`the page links to a site that the app does not: ${h}`);
  if (differences === before) console.log(`  the same: ${PAYMENTS.length} payments`);
}

await browser.close();
console.log(differences ? `${differences} difference(s). Update the copies and their read dates.` : "No differences.");
process.exit(differences ? 1 : 0);
