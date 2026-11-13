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
  await expect(page.getByText(/Main|Grand|Walnut|\d+(st|nd|rd|th)/i).first()).toBeVisible({ timeout: 60_000 });
  expect(await drawnIcons(page)).toEqual([]);
  expect(page.errors).toEqual([]);
});

test("City meetings: the list, a meeting sheet, subscribe, and the boards", async ({ context }) => {
  const { page } = await ownerPage(context);
  // The old address under City forwards to the Meetings tab.
  await page.goto("/#/city/meetings");
  await expect(page).toHaveURL(/#\/meetings$/);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Meetings", exact: true }).click();
  await expect(page.locator("#title")).toHaveText("City meetings");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Meetings", exact: true })).toHaveAttribute("aria-current", "page");
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

test("Police report: above the streetcar, the department's forms, the numbers, and the way to a copy", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/#/services");
  // Neither is part of 311, and the police come first.
  await expect(page.locator("#body a.tile.accent .sub.strong")).toHaveText(["Police report", "KC Streetcar"], { timeout: 20_000 });
  await page.locator("#body a.tile.accent").first().click();
  await expect(page.locator("#title")).toHaveText("Police report");
  await expect(page.getByText("Not part of 311. This goes to the Kansas City Police Department.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Call 911" })).toHaveAttribute("href", "tel:911");
  await expect(page.getByRole("link", { name: "Call 816-234-5111" })).toHaveAttribute("href", "tel:8162345111");
  // Thirteen report types: twelve open the department's form for that type, one opens a department page.
  const forms = page.locator("#pd-list a");
  await expect(forms).toHaveCount(13);
  expect(await forms.evaluateAll((as) => as.filter((a) => a.href.startsWith("https://secure.coplogic.com/dors/startreport/300005194/")).length)).toBe(12);
  await expect(forms.first()).toHaveAttribute("href", /\/300010003$/);
  await expect(page.getByRole("link", { name: /Request a report online/ })).toHaveAttribute("href", "https://secure.coplogic.com/rar/startrequest/200000962/");
  await expect(page.getByRole("link", { name: /Call Criminal Records: 816-234-5100/ })).toHaveAttribute("href", "tel:8162345100");
  // The city's own link goes to a host whose certificate expired. No link here uses that host.
  expect(await page.locator('a[href*="kcpd.org"]').count()).toBe(0);
  expect(await axe(page)).toEqual([]);
  expect(await drawnIcons(page)).toEqual([]);
  await page.getByRole("button", { name: "Español" }).click();
  await expect(forms.first()).toHaveAttribute("href", /\/300010003\/es$/);
  await expect(page.getByRole("link", { name: /Request a report online/ })).toHaveAttribute("href", /\/200000962\/es$/);
  // The A to Z list finds a police report by its type, and Health & Safety opens the same screen.
  await page.goto("/#/services/all");
  await page.getByLabel("Search everything").fill("lost property");
  await page.getByRole("link", { name: /Police report, lost property/ }).click();
  await expect(page.locator("#title")).toHaveText("Police report");
  await page.goto("/#/services/section/safety");
  await page.getByRole("link", { name: "Make a police report" }).click();
  await expect(page.locator("#title")).toHaveText("Police report");
  expect(page.errors).toEqual([]);
});



test("City notices: the Report tab shows a notice until the person hides it, and the City tab keeps it", async ({ context }) => {
  // Fixture data: the notice that the city had on 2026-11-12, one that is too old, and one with markup in its text.
  const day = 86400e3;
  const trash = { id: "18566", title: "Veteran's Day Holiday Trash & Recycling Collection Delay",
    text: "In observance of the Veteran's Day Holiday on Wednesday, November 11th, Trash & Recycling Collection will be on a one-day delay the rest of the week. For more information, please visit HERE",
    links: [{ text: "HERE", url: "https://www.kcmo.gov/trash" }], at: Date.now() - 2 * day };
  const old = { id: "17000", title: "A notice from two months ago", text: "Old text.", links: [], at: Date.now() - 60 * day };
  const markup = { id: "18570", title: "Snow <b>plan</b>", text: "Crews treat <i>primary</i> routes first.<script>window.bad = 1</script>", links: [{ text: "x", url: "javascript:window.bad = 2" }], at: Date.now() - 3 * day };
  const { page } = await ownerPage(context, { notices: [old, markup, trash] });
  await page.goto("/#/report");
  const cards = page.locator("#notices section.notice");
  await expect(cards).toHaveCount(2);
  // Newest first, above the place of the trash day, with the link named by its address.
  await expect(cards.first().getByRole("heading")).toHaveText("Veteran's Day Holiday Trash & Recycling Collection Delay");
  await expect(cards.first()).toContainText("one-day delay the rest of the week");
  await expect(cards.first()).toContainText(/From the city, \w{3} \d{1,2}, \d{4}/);
  await expect(cards.first().getByRole("link", { name: "kcmo.gov/trash" })).toHaveAttribute("href", "https://www.kcmo.gov/trash");
  expect(await page.evaluate(() => !!(document.querySelector("#notices").compareDocumentPosition(document.querySelector("#near")) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  // Markup in a notice is text on the page, and an address that is not a web address goes nowhere.
  await expect(cards.nth(1).getByRole("heading")).toHaveText("Snow <b>plan</b>");
  expect(await cards.nth(1).locator("h2 *, p *, script").count()).toBe(0);
  await expect(cards.nth(1).locator("p.prewrap")).toHaveText("Crews treat <i>primary</i> routes first.<script>window.bad = 1</script>");
  await expect(cards.nth(1).getByRole("link")).toHaveAttribute("href", "#");
  expect(await page.evaluate(() => window.bad)).toBeUndefined();
  expect(await axe(page)).toEqual([]);
  expect(await drawnIcons(page)).toEqual([]);
  // Hidden on this tab, and it stays hidden.
  await cards.first().getByRole("button", { name: "Hide this notice" }).click();
  await expect(cards).toHaveCount(1);
  await expect(page.getByText("City notices are on the City tab.")).toBeVisible();
  // The choice is kept on the device, so the next open of the app has it. (No reload here: WebKit reports the calls that a reload stops as page errors.)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("noticesHidden")))).toEqual(["18566"]);
  await page.goto("/#/services");
  await page.goto("/#/report");
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole("heading")).toHaveText("Snow <b>plan</b>");
  // The City tab has both, with no hide button, and its search finds a notice by its words.
  await page.goto("/#/city");
  await expect(page.getByRole("heading", { name: "City notices" })).toBeVisible();
  const kept = page.locator("section.notice");
  await expect(kept).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Hide this notice" })).toHaveCount(0);
  const search = page.getByRole("searchbox").first();
  await search.fill("recycling");
  await expect(kept).toHaveCount(1);
  await search.fill("tow lot");
  await expect(kept).toHaveCount(0);
  await search.fill("");
  expect(await axe(page)).toEqual([]);
  expect(page.errors).toEqual([]);
});

test("Pay: each bill and ticket opens the payment page of its office", async ({ context }) => {
  const { page } = await ownerPage(context);
  // The Pay card is on the City tab, under Health and help. The Services tab does not show it.
  await page.goto("/#/services");
  await expect(page.getByRole("link", { name: /KC Streetcar/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Pay a bill or a ticket/ })).toHaveCount(0);
  await page.goto("/#/city");
  const card = page.getByRole("link", { name: /Pay a bill or a ticket/ });
  await expect(card).toHaveCount(1);
  expect(await page.evaluate(() => {
    const top = (re) => [...document.querySelectorAll("main a")].find((a) => re.test(a.textContent)).getBoundingClientRect().top;
    return top(/Health and help/) < top(/Pay a bill or a ticket/) && top(/Pay a bill or a ticket/) < top(/Call 311/);
  })).toBe(true);
  // The search finds the card by the name of a payment, and hides it for other words.
  const search = page.getByRole("searchbox").first();
  await search.fill("water bill");
  await expect(card).toBeVisible();
  await search.fill("tow lot");
  await expect(card).toHaveCount(0);
  await search.fill("");
  expect(await axe(page)).toEqual([]);
  await card.click();
  await expect(page).toHaveURL(/#\/city\/pay$/);
  await expect(page.locator("#title")).toHaveText("Pay");
  await expect(page.getByText("This app takes no card numbers.")).toBeVisible();
  const rows = page.locator("#pay-list a");
  await expect(rows).toHaveCount(12);
  // Every row leaves the app for a secure page of the office, in a new tab.
  expect(await rows.evaluateAll((as) => as.filter((a) => a.href.startsWith("https://") && a.target === "_blank" && !a.href.includes(location.host)).length)).toBe(12);
  await expect(rows.first()).toHaveAttribute("href", "https://my.kcwater.us/eportal/#/accountlookup/pay");
  await expect(page.getByText(/Towing fees: only in person/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
  expect(await drawnIcons(page)).toEqual([]);
  // The A to Z list finds a payment by the paper in the person's hand.
  await page.goto("/#/services/all");
  await page.getByLabel("Search everything").fill("parking ticket");
  await page.getByRole("link", { name: /Pay: Parking ticket/ }).click();
  await expect(page.locator("#title")).toHaveText("Pay");
  expect(page.errors).toEqual([]);
});
