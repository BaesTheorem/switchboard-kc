// A deploy and an open app. The service worker of the new version takes over
// a page that still runs the old scripts, and screens that load later come
// from the new version. On 2026-11-12 that gave a new card with no route for
// it. The page must load again, one time, when a new worker takes over, and
// it must wait while a person fills a form.
//
// This test needs two versions, so it does not use the deployed server: a
// local server gives out web/public and can change the worker's VERSION. The
// city API is not there (each call fails, as when offline).

import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pub = join(dirname(fileURLToPath(import.meta.url)), "../../public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

test.use({ serviceWorkers: "allow" });

test("a new version takes over: the page loads again one time, never in a loop, and not in the middle of a form", async ({ context, browserName }) => {
  test.skip(browserName !== "chromium", "Service workers in a test page are a Chromium feature here.");
  let version = "TEST-1";
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path.startsWith("/api/")) { res.writeHead(503, { "content-type": "application/json" }); res.end('{"ok":false,"error":"test","message":"no server in this test"}'); return; }
    const file = join(pub, path === "/" ? "index.html" : decodeURIComponent(path));
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
    let body = readFileSync(file);
    if (path === "/sw.js") body = Buffer.from(body.toString().replace(/const VERSION = "[^"]+";/, `const VERSION = "${version}";`));
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await context.newPage();
    let loads = 0;
    page.on("load", () => { loads++; });
    const cache = () => page.evaluate(async () => (await caches.keys()).join(","));
    const cacheIs = (name) => page.waitForFunction(async (n) => (await caches.keys()).join(",") === n, name, { timeout: 60_000 });

    // The first install: the page and the worker have the same version, so nothing loads again.
    await page.goto(`${base}/#/report`);
    await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
    await cacheIs("switchboard-TEST-1");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForTimeout(1500);
    expect(loads).toBe(1);

    // A deploy, then the person comes back one time. The app loads the page again by itself, and only one cache is left.
    version = "TEST-2";
    loads = 0;
    await page.reload();
    await cacheIs("switchboard-TEST-2");
    await expect.poll(() => loads, { timeout: 30_000 }).toBe(2);
    await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
    await page.waitForTimeout(5000);
    expect(loads).toBe(2);   // no loop

    // The next deploy arrives while a form is open: the page waits, and loads again at the next screen.
    await page.goto(`${base}/#/services/streetcar`);
    await expect(page.locator("#title")).toHaveText("Streetcar");
    version = "TEST-3";
    loads = 0;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await cacheIs("switchboard-TEST-3");
    await page.waitForTimeout(3000);
    expect(loads).toBe(0);
    expect(await page.evaluate(() => location.hash)).toBe("#/services/streetcar");
    await page.evaluate(() => { location.hash = "#/services"; });
    await expect.poll(() => loads, { timeout: 30_000 }).toBe(1);
    expect(await cache()).toBe("switchboard-TEST-3");
  } finally {
    server.close();
  }
});
