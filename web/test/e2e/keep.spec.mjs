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
  await page.getByRole("button", { name: "Save to a passkey" }).click();
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
  await expect(page.getByRole("heading", { name: "Used Switchboard KC before?" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("heading", { name: "Used Switchboard KC before?" })).toBeHidden();
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
