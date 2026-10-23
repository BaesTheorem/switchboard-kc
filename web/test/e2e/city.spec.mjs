// The City tab, Health and help, the basic-needs lists, license offices,
// transit, and the streetcar form. These read open data and the city API;
// nothing is filed or sent.

import { expect, test } from "@playwright/test";
import { axe, BASE, drawnIcons, ownerPage } from "./helpers.mjs";

test.use({ baseURL: BASE });

test("City tab: phone numbers, search, and the screens under it", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/#/city");
  await expect(page.getByRole("link", { name: /Call 311/ })).toHaveAttribute("href", "tel:8165131313");
  await expect(page.getByText(/More city numbers \(25\)/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
  const search = page.getByRole("searchbox").first();
  await search.fill("tow");
  await expect(page.getByRole("link", { name: /Tow lot/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Call 311/ })).toBeHidden();
  await search.fill("");
  await page.getByRole("link", { name: /License offices/ }).click();
  await expect(page.locator("#title")).toHaveText("License offices");
  await expect(page.getByRole("link", { name: "Call" }).first()).toBeVisible({ timeout: 30_000 });
  expect(await axe(page)).toEqual([]);
  await page.locator("#back").click();
  await expect(page.locator("#title")).toHaveText("City");
  await page.getByRole("link", { name: /Buses and streetcar/ }).click();
  await expect(page.locator("#title")).toHaveText("Buses and streetcar");
  // Downtown has stops within half a mile; their names come from RideKC's schedule.
  await expect(page.getByText(/Main|Grand|Walnut|\d+(st|nd|rd|th)/).first()).toBeVisible({ timeout: 60_000 });
  expect(await drawnIcons(page)).toEqual([]);
  expect(page.errors).toEqual([]);
});

test("City meetings: the list, a meeting sheet, subscribe, and the boards", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/#/city");
  await page.getByRole("link", { name: /City meetings/ }).click();
  await expect(page.locator("#title")).toHaveText("City meetings");
  await expect(page.getByText(/meetings coming up/)).toBeVisible({ timeout: 30_000 });
  expect(await axe(page)).toEqual([]);
  // A meeting opens its sheet with the comment rule and calendar links.
  await page.locator('[data-act="open"]').first().click();
  await expect(page.getByRole("heading", { name: "Public comment" })).toBeVisible();
  const ics = page.getByRole("link", { name: /\.ics file/ });
  await expect(ics).toHaveAttribute("href", /^\/cal\/meeting\/[\w-]+\.ics$/);
  await expect(page.getByRole("link", { name: "Google Calendar" })).toHaveAttribute("href", /^https:\/\/calendar\.google\.com\//);
  // The sheet fades in; check the contrast once it is fully drawn.
  await page.locator("#sheet").evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)));
  expect(await axe(page)).toEqual([]);
  await page.keyboard.press("Escape");
  // Subscribe to every meeting: a webcal link to this server's feed.
  await page.getByRole("button", { name: /Subscribe to every meeting/ }).click();
  await expect(page.getByRole("link", { name: /Apple Calendar/ })).toHaveAttribute("href", /^webcal:\/\/.+\/cal\/all\.ics$/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Boards" }).click();
  await expect(page.getByRole("button", { name: "Boards" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "City Council" })).toBeVisible();
  await page.getByRole("searchbox").fill("plan commission");
  await expect(page.getByText("City Plan Commission").first()).toBeVisible();
  expect(await drawnIcons(page)).toEqual([]);
  expect(page.errors).toEqual([]);
});

test("Health and help, and a basic-needs list", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/#/report");
  await page.getByRole("link", { name: /Health and help/ }).click();
  await expect(page.locator("#title")).toHaveText("Health and help");
  await expect(page.getByRole("link", { name: /Call 911/ })).toHaveAttribute("href", /^tel:911/);
  await expect(page.getByText("988 Suicide & Crisis Lifeline")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole("link", { name: /Somewhere to stay/ }).click();
  await expect(page.locator("#title")).toHaveText("Somewhere to stay");
  await expect(page.getByRole("heading", { name: "Shelters and housing" })).toBeVisible();
  await expect(page.getByText(/Emergency shelter|Transitional housing|Safe haven/).first()).toBeVisible({ timeout: 45_000 });
  expect(await axe(page)).toEqual([]);
  // Back goes to Health and help, then to the Report tab, through the router.
  await page.locator("#back").click();
  await expect(page.locator("#title")).toHaveText("Health and help");
  await page.locator("#back").click();
  await expect(page.locator("#title")).toHaveText("Switchboard KC");
});

test("KC Streetcar form: the nearest stop, the report types, and the channels", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/#/services");
  await page.getByRole("link", { name: /KC Streetcar/ }).click();
  await expect(page.locator("#title")).toHaveText("Streetcar");
  await expect(page.getByLabel("What happened")).toHaveValue("Cleanliness / Trash");
  // 39.0997, -94.5786 is at 12th and Main.
  await expect(page.locator("#sc-stop")).toHaveValue("Metro Center (12th & Main)", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Add details" })).toBeDisabled();
  await page.getByLabel("Details").fill("Broken glass on the platform.");
  await expect(page.getByRole("button", { name: /Text dispatch \(See Say\)/ })).toBeEnabled();
  await page.getByLabel("What happened").selectOption("Arrival sign / tracker wrong");
  await expect(page.getByRole("button", { name: /Email the Authority/ }).first()).toBeEnabled();
  expect(await axe(page)).toEqual([]);
});
