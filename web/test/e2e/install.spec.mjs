// The Home Screen offer at launch (views/addhome.js). A phone browser tab
// opens with the sheet in front of its first screen, with the steps for that
// browser; a browser inside another app gets the way to a real browser; the
// installed app and a computer get no sheet. The engine is the real one for
// each case (WebKit for iPhone, Chromium for Android), and the user agent is
// the browser's own. Nothing is filed.

import { expect, test } from "@playwright/test";
import { axe, BASE, drawnIcons, ownerPage } from "./helpers.mjs";

test.use({ baseURL: BASE });

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WEBVIEW = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240905.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.83 Mobile Safari/537.36";
const DAY = 86400e3;

const sheetOf = (page) => page.locator("dialog#sheet[open]");
/** The sheet fades in. A check of its colors waits for the end of that. */
const shown = (page) => expect(sheetOf(page)).toHaveCSS("opacity", "1");
/** No request is on its way: a reload in the middle of the start-up requests makes WebKit report each one as a page error. */
const quiet = (page) => page.waitForLoadState("networkidle");
/** The app's first screen is on the page, and the sheet had its time to open. */
async function settled(page) {
  await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  await page.waitForTimeout(1500);
}

test.describe("Safari 27 on iPhone", () => {
  test.use({ userAgent: `${IPHONE} Version/27.1 Mobile/15E148 Safari/604.1` });

  test("the sheet opens first, and Not now keeps it away for 90 days", async ({ context, browserName }) => {
    test.skip(browserName !== "webkit", "Safari is WebKit.");
    const { page } = await ownerPage(context, { offer: true });
    // This test loads the page three times. The city's map call is slow, and no check here reads it.
    await page.route("**/api/map", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, response_status: { response_data: [] } }) }));
    await page.goto("/");
    const sheet = sheetOf(page);
    await expect(sheet.getByRole("heading", { name: "Add to Home Screen" })).toBeVisible();
    // Safari 27 keeps Share behind the Page Menu button (three lines).
    await expect(sheet.locator("ol.steps > li")).toHaveCount(4);
    // (The text of a step has the icon's name in it, so the checks read around the icon.)
    await expect(sheet.locator("ol.steps > li").first()).toContainText("menu button in Safari's toolbar, then tap Share.");
    await expect(sheet.locator("ol.steps > li").first().locator("i").first()).toHaveText("notes");
    await expect(sheet.getByText("If the toolbar has the")).toBeVisible();
    // The title has the focus, so no answer looks chosen and a screen reader starts at the title.
    await expect(sheet.locator("#sheet-title")).toBeFocused();
    await expect(sheet.getByText("Keep Open as Web App on, then tap Add.")).toBeVisible();
    await expect(sheet.locator("img.app-icon")).toBeVisible();
    expect(await sheet.locator("img.app-icon").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await drawnIcons(page)).toEqual([]);
    await shown(page);
    expect(await axe(page)).toEqual([]);

    await sheet.getByRole("button", { name: "Not now" }).click();
    await expect(sheetOf(page)).toHaveCount(0);
    await expect(page.locator("#snack")).toHaveText("You can add it anytime in Settings, under Install.");
    const asked = await page.evaluate(() => JSON.parse(localStorage.getItem("installAsked")));
    expect(Date.now() - asked).toBeLessThan(60_000);

    // The next start has no sheet.
    await quiet(page);
    await page.reload();
    await settled(page);
    await expect(sheetOf(page)).toHaveCount(0);
    // Settings keeps the same steps.
    await page.locator("#cog").click();
    await expect(sheetOf(page).getByRole("heading", { name: "Install", exact: true })).toBeVisible();
    await expect(sheetOf(page).locator("ol.steps > li").first()).toContainText("menu button in Safari's toolbar, then tap Share.");
    await sheetOf(page).getByRole("button", { name: "Done" }).click();

    // After 90 days the sheet comes back one time.
    await page.evaluate((t) => localStorage.setItem("installAsked", String(t)), Date.now() - 91 * DAY);
    await quiet(page);
    await page.reload();
    await expect(sheetOf(page).getByRole("heading", { name: "Add to Home Screen" })).toBeVisible();
    expect(page.errors).toEqual([]);
  });

  test("a start on Report sent keeps the install card and opens no sheet", async ({ context, browserName }) => {
    test.skip(browserName !== "webkit", "Safari is WebKit.");
    const { page } = await ownerPage(context, { offer: true });
    await page.addInitScript(() => sessionStorage.setItem("done:report", JSON.stringify({ wo: "123456" })));
    await page.goto("/#/report/done");
    await expect(page.getByRole("heading", { name: "Report sent", level: 2 })).toBeVisible();
    await expect(page.locator("#keep, #alerts").getByRole("heading", { name: /Home Screen/ })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(sheetOf(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("installAsked"))).toBeNull();
    expect(page.errors).toEqual([]);
  });

  test("the Home Screen app has no sheet", async ({ context, browserName }) => {
    test.skip(browserName !== "webkit", "Safari is WebKit.");
    const { page } = await ownerPage(context, { offer: true });
    // Safari sets navigator.standalone in an app opened from the Home Screen.
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true }));
    await page.goto("/");
    await settled(page);
    await expect(sheetOf(page)).toHaveCount(0);
    expect(page.errors).toEqual([]);
  });
});

test.describe("a 320 px iPhone", () => {
  test.use({ userAgent: `${IPHONE} Version/27.1 Mobile/15E148 Safari/604.1`, viewport: { width: 320, height: 568 } });

  test("the sheet fits: no button breaks into two lines, and the last step is in reach", async ({ context, browserName }) => {
    test.skip(browserName !== "webkit", "Safari is WebKit.");
    const { page } = await ownerPage(context, { offer: true });
    await page.goto("/");
    const sheet = sheetOf(page);
    await shown(page);
    const notNow = await sheet.getByRole("button", { name: "Not now" }).boundingBox();
    expect(notNow.height).toBeLessThan(50);
    const box = await sheet.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    // The sheet is taller than this screen, so it scrolls to its last step.
    const last = sheet.locator("ol.steps > li").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    expect(page.errors).toEqual([]);
  });
});

for (const [name, version, icon] of [["Safari 26", "26.1", "more_horiz"], ["Safari 18", "18.6", "ios_share"]]) {
  test.describe(`${name} on iPhone`, () => {
    test.use({ userAgent: `${IPHONE} Version/${version} Mobile/15E148 Safari/604.1` });

    test("the first step names the button that this Safari has", async ({ context, browserName }) => {
      test.skip(browserName !== "webkit", "Safari is WebKit.");
      const { page } = await ownerPage(context, { offer: true });
      await page.goto("/");
      const first = sheetOf(page).locator("ol.steps > li").first();
      await expect(first.locator("i").first()).toHaveText(icon);
      // Safari 26 put Share behind the More button. Safari 18 has it in the toolbar.
      await expect(first).toContainText(version === "18.6" ? "Share button in Safari's toolbar." : "menu button in Safari's toolbar, then tap Share.");
      expect(await drawnIcons(page)).toEqual([]);
      expect(page.errors).toEqual([]);
    });
  });
}

test.describe("Chrome on iPhone", () => {
  test.use({ userAgent: `${IPHONE} CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1` });

  test("the steps name Chrome's address bar", async ({ context, browserName }) => {
    test.skip(browserName !== "webkit", "Each browser on iPhone is WebKit.");
    const { page } = await ownerPage(context, { offer: true });
    await page.goto("/");
    const first = sheetOf(page).locator("ol.steps > li").first();
    await expect(first).toContainText("Share button at the right of Chrome's address bar.");
    await expect(first.locator("i")).toHaveText("ios_share");
    expect(page.errors).toEqual([]);
  });
});

test.describe("Instagram's browser on iPhone", () => {
  test.use({ userAgent: `${IPHONE} Mobile/22F76 Instagram 393.1.0.36.70 (iPhone15,3; iOS 18_5; en_US; en; scale=3.00; 1290x2796; IABMV/1; 776538208) Safari/604.1)` });

  test("the sheet shows the way to Safari, and copies the link", async ({ context, browserName }) => {
    test.skip(browserName !== "webkit", "Each browser on iPhone is WebKit.");
    const { page } = await ownerPage(context, { offer: true });
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.copied = t; } } }));
    await page.goto("/#/meetings");
    const sheet = sheetOf(page);
    await expect(sheet.getByRole("heading", { name: "Open in Safari first" })).toBeVisible();
    await expect(sheet.getByText("Instagram's built-in browser cannot add an app to the Home Screen. Open this page in Safari first.")).toBeVisible();
    await expect(sheet.locator("ol.steps > li")).toHaveCount(3);
    await expect(sheet.locator("ol.steps")).toContainText("Tap Open in Safari or Open in browser.");
    await expect(sheet.locator("ol.steps")).not.toContainText("Add to Home Screen");
    await shown(page);
    expect(await axe(page)).toEqual([]);
    await sheet.getByRole("button", { name: "Copy the link" }).click();
    await expect(page.locator("#snack")).toHaveText("Link copied. Paste it in Safari.");
    expect(await page.evaluate(() => window.copied)).toBe(`${BASE}/#/meetings`);
    // The sheet stays for the copy, so the person still reads the steps.
    await expect(sheet).toBeVisible();
    expect(page.errors).toEqual([]);
  });
});

test.describe("Chrome on Android", () => {
  test("the steps come first, and Chrome's prompt takes their place when Chrome gives it", async ({ context, browserName }) => {
    test.skip(browserName !== "chromium", "Chrome is Chromium.");
    const { page } = await ownerPage(context, { offer: true });
    await page.goto("/");
    const sheet = sheetOf(page);
    await expect(sheet.getByRole("heading", { name: "Add to Home Screen" })).toBeVisible();
    await expect(sheet.locator("ol.steps > li").first()).toContainText("menu button at the right of Chrome's address bar.");
    await expect(sheet.locator("ol.steps")).toContainText("Tap Install and create shortcut.");
    expect(await drawnIcons(page)).toEqual([]);
    await shown(page);
    expect(await axe(page)).toEqual([]);

    // Chrome gives its prompt after a tap and 30 seconds on the page. The test gives one with the same shape.
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      window.prompted = 0;
      e.prompt = async () => { window.prompted += 1; };
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(e);
    });
    await expect(sheet.locator("ol.steps")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Install the app" }).click();
    await expect(sheetOf(page)).toHaveCount(0);
    await expect(page.locator("#snack")).toHaveText("Installed. Open Switchboard KC from your Home Screen.");
    expect(await page.evaluate(() => window.prompted)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("installAsked"))).not.toBeNull();
    expect(page.errors).toEqual([]);
  });

  test("an install from Chrome's own menu closes the sheet", async ({ context, browserName }) => {
    test.skip(browserName !== "chromium", "Chrome is Chromium.");
    const { page } = await ownerPage(context, { offer: true });
    await page.goto("/");
    await expect(sheetOf(page).getByRole("heading", { name: "Add to Home Screen" })).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(sheetOf(page)).toHaveCount(0);
    // The app is installed, so Settings has no Install section.
    await page.locator("#cog").click();
    await expect(sheetOf(page).getByRole("heading", { name: "Appearance" })).toBeVisible();
    await expect(sheetOf(page).getByRole("heading", { name: "Install", exact: true })).toHaveCount(0);
    expect(page.errors).toEqual([]);
  });

  test("the installed app has no sheet", async ({ context, browserName }) => {
    test.skip(browserName !== "chromium", "Chrome is Chromium.");
    const { page } = await ownerPage(context, { offer: true });
    // Chrome answers this media query with true in an app opened from the Home Screen.
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q.includes("display-mode: standalone") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
    });
    await page.goto("/");
    await settled(page);
    await expect(sheetOf(page)).toHaveCount(0);
    expect(page.errors).toEqual([]);
  });
});

test.describe("Facebook's browser on Android", () => {
  test.use({ userAgent: `${WEBVIEW} [FB_IAB/FB4A;FBAV/488.0.0.62.79;IABMV/1;]` });

  test("the sheet shows the way to a real browser", async ({ context, browserName }) => {
    test.skip(browserName !== "chromium", "An Android web view is Chromium.");
    const { page } = await ownerPage(context, { offer: true });
    await page.goto("/");
    const sheet = sheetOf(page);
    await expect(sheet.getByRole("heading", { name: "Open in your browser first" })).toBeVisible();
    await expect(sheet.getByText("Facebook's built-in browser cannot add an app to the Home Screen. Open this page in your browser first.")).toBeVisible();
    await expect(sheet.locator("ol.steps")).toContainText("Tap Open in Chrome or Open in browser.");
    await expect(sheet.getByRole("button", { name: "Copy the link" })).toBeVisible();
    expect(page.errors).toEqual([]);
  });
});

test.describe("a computer", () => {
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.96 Safari/537.36" });

  test("there is no sheet", async ({ context, browserName }) => {
    test.skip(browserName !== "chromium", "One engine is enough for the computer.");
    const { page } = await ownerPage(context, { offer: true });
    await page.goto("/");
    await settled(page);
    await expect(sheetOf(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("installAsked"))).toBeNull();
    expect(page.errors).toEqual([]);
  });
});
