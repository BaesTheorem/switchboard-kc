#!/usr/bin/env node
// Screenshots of the main screens on an iPhone-sized WebKit page, light and
// dark, for the README and for a side-by-side check with the iPhone app.
//   node test/screens.mjs [base-url]
// Uses a fresh reports id (no reports) and a downtown position; files nothing.
import { devices, webkit } from "@playwright/test";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const base = process.argv[2] || env.URL;
const out = new URL("../docs/screenshots/", import.meta.url).pathname;
const b = await webkit.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await b.newContext({ ...devices["iPhone 13"], colorScheme: scheme, serviceWorkers: "block" });
  await ctx.grantPermissions(["geolocation"]);
  await ctx.setGeolocation({ latitude: 39.0997, longitude: -94.5786 });
  await ctx.addInitScript(([o]) => {
    localStorage.setItem("dryRun", "true");
    localStorage.setItem("ownerToken", JSON.stringify(o));
    localStorage.setItem("deviceUID", JSON.stringify("5c5c5c5c5c5c5c5c"));
  }, [env.ADMIN_TOKEN]);
  const p = await ctx.newPage();
  const shot = async (name, hash, wait, after) => {
    await p.goto(`${base}/${hash}`);
    if (wait) await p.locator(wait).first().waitFor({ timeout: 60000 });
    if (after) await after();
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${out}${name}-${scheme}.png` });
  };
  await shot("report", "#/report", "text=Report a problem");
  await shot("services", "#/services", "text=Streets & Sidewalks");
  await shot("form", "#/services/all", "#q", async () => {
    await p.getByLabel("Search everything").fill("Pothole in the Street");
    await p.locator("[data-pick]").first().click();
    await p.locator("#loc").getByText(/GPS/).waitFor({ timeout: 30000 });
  });
  await shot("map", "#/reports", "#map canvas", async () => p.locator("#caption").getByText(/[1-9]\d* nearby/).waitFor({ timeout: 60000 }));
  await shot("city", "#/city", "text=Phone numbers");
  await shot("help", "#/city/help", "text=Help now");
  await ctx.close();
}
await b.close();
console.log("screenshots in", out);
