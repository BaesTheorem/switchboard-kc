// The installed-app side: the manifest is installable, the service worker
// keeps the app shell for offline use, and the security headers are set.

import { expect, test } from "@playwright/test";
import { BASE, ownerPage } from "./helpers.mjs";

test.use({ baseURL: BASE });

test("Chrome finds no installability errors", async ({ context, browserName }) => {
  test.skip(browserName !== "chromium", "installability is a Chrome check");
  const { page } = await ownerPage(context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
  const manifest = await (await page.request.get(`${BASE}/manifest.webmanifest`)).json();
  expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
});

test.describe("offline shell", () => {
  test.use({ serviceWorkers: "allow" });

  test("the app opens offline once the service worker has it", async ({ context, browserName }) => {
    test.skip(browserName === "webkit", "Playwright's WebKit stops with an internal error on reload under a service worker");
    const { page } = await ownerPage(context);
    // No mocked submits here (routes do not see service-worker traffic); this test files nothing.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Services" }).click();
    // The saved catalog carries the Services list without the network.
    await expect(page.getByRole("link", { name: /Streets & Sidewalks/ })).toBeVisible();
    await context.setOffline(false);
  });
});

test("security headers on the app", async ({ request }) => {
  const r = await request.get(`${BASE}/`);
  const csp = r.headers()["content-security-policy"] || "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  const api = await request.post(`${BASE}/api/myissues`, { headers: { origin: "https://example.org" }, data: { device: "0123456789abcdef" } });
  expect(api.status()).toBe(403);
});
