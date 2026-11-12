// Keeping a person's reports: the Home Screen install card and the reports id
// in a passkey. The passkey test runs on Chromium only, with Chrome's virtual
// authenticator (DevTools WebAuthn domain); nothing reaches a real password
// manager. Nothing is filed.

import { expect, test } from "@playwright/test";
import { axe, BASE, ownerPage } from "./helpers.mjs";

test.use({ baseURL: BASE });

const OTHER = "fedcba9876543210";

test("the reports id goes into a passkey and comes back from it", async ({ context, browserName }) => {
  test.skip(browserName !== "chromium", "The virtual authenticator is a Chromium DevTools feature.");
  const { page } = await ownerPage(context, { device: "a1b2c3d4e5f60718" });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto("/");
  await page.locator("#cog").click();
  await page.locator("#sheet").getByRole("button", { name: "Save to a passkey" }).click();
  await expect(page.getByText("Saved to a passkey on this device.")).toBeVisible();
  // The authenticator now holds one discoverable credential whose user handle is the id.
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(Buffer.from(credentials[0].userHandle, "base64").toString()).toBe("a1b2c3d4e5f60718");

  // A new id on this device (as after clearing the site's data), then a restore.
  await page.evaluate((id) => { localStorage.setItem("deviceUID", JSON.stringify(id)); localStorage.removeItem("passkeyFor"); }, OTHER);
  await page.reload();
  await page.locator("#cog").click();
  await expect(page.getByText(OTHER)).toBeVisible();
  await page.getByRole("button", { name: "Restore from a passkey" }).click();
  await expect(page.getByText("a1b2c3d4e5f60718")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("deviceUID")))).toBe("a1b2c3d4e5f60718");
  expect(page.errors).toEqual([]);
});

test("the Report tab offers a restore when there are no reports, and Report sent shows the install card", async ({ context, browserName }) => {
  const { page } = await ownerPage(context, { device: "0f0f0f0f0f0f0f0f" });
  await page.route("**/api/myissues", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, my_issues: [] }) }));
  await page.goto("/");
  const homeCard = (name) => page.locator("section.card", { has: page.getByRole("heading", { name }) });
  await expect(homeCard("Used Switchboard KC before?")).toBeVisible({ timeout: 20_000 });
  // The passkey card is on the home screen before the first report. Each card stays until it is closed, and then says where its buttons are.
  await expect(homeCard("Keep your reports if you lose this phone")).toBeVisible();
  await homeCard("Used Switchboard KC before?").getByRole("button", { name: "Not now" }).click();
  await expect(homeCard("Used Switchboard KC before?")).toBeHidden();
  await expect(page.locator("#snack")).toHaveText("You can restore anytime in Settings, under My reports.");
  await expect(homeCard("Keep your reports if you lose this phone")).toBeVisible();
  await homeCard("Keep your reports if you lose this phone").getByRole("button", { name: "Not now" }).click();
  await expect(homeCard("Keep your reports if you lose this phone")).toBeHidden();
  await expect(page.locator("#snack")).toHaveText("You can save it anytime in Settings, under My reports.");
  // The install card on the Report sent screen: the iPhone steps name Safari's Share button.
  await page.evaluate(() => sessionStorage.setItem("done:report", JSON.stringify({ wo: "123456" })));
  await page.goto("/#/report/done");
  const card = page.locator("#keep, #alerts").getByRole("heading", { name: /Home Screen/ });
  await expect(card).toBeVisible();
  if (browserName === "webkit") await expect(page.getByText(/Tap the Share button/)).toBeVisible();
  else await expect(page.getByText(/Tap the menu button/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "Not now" }).first().click();
  expect(page.errors).toEqual([]);
});
