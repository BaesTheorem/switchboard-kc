// End-to-end tests of the web app against a deployed server and the live city
// API. Nothing is filed: every test page sends the dry-run header, so the
// server checks a report and then does not pass it on, and helpers.mjs also
// answers /api/submit inside the page.

import { expect, test } from "@playwright/test";
import { axe, BASE, drawnIcons, issueFrom, jpegWithGps, OWNER, ownerPage, TEST_DEVICE } from "./helpers.mjs";

test.use({ baseURL: BASE });

const sent = (page) => page.getByRole("heading", { level: 2, name: "Report sent" });

/** Opens the pothole form from the A to Z list and answers its one question. */
async function potholeForm(page) {
  await page.goto("/#/services/all");
  await page.getByLabel("Search everything").fill("Pothole in the Street");
  await page.locator("[data-pick]").first().click();
  await expect(page.locator("#title")).toHaveText("Details");
  await expect(page.locator("#loc")).toContainText(/GPS/, { timeout: 30_000 });
  await page.getByRole("button", { name: "One pothole" }).click();
}

const revokeLater = [];
test.afterAll(async ({ request }) => {
  for (const id of revokeLater.splice(0)) await request.post(`${BASE}/api/admin/invites/revoke`, { headers: { "x-admin-token": OWNER }, data: { id } });
});

test.describe("access", () => {
  test("a visitor without an invite sees the invite screen, and a wrong code is refused", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Join this Switchboard KC server" })).toBeVisible();
    await page.getByLabel("Invite code").fill("aaaa-bbbb-cccc-dddd");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.getByText("That invite code does not work.")).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("an invite link joins the server, once per use", async ({ page, request }) => {
    const r = await request.post(`${BASE}/api/admin/invites`, { headers: { "x-admin-token": OWNER }, data: { label: "e2e test", max: 1 } });
    const inv = await r.json();
    expect(inv.ok).toBe(true);
    // The invite is revoked at the end even when the test fails part way.
    test.info().attach("invite", { body: inv.id });
    revokeLater.push(inv.id);
    await page.goto(`/#invite=${inv.code}`);
    // The app redeems the code, keeps the session, and reloads without the invite screen.
    // The page reloads part way through, so a read can land between two documents; that read counts as "not yet".
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("session") || "null")).catch(() => null), { timeout: 20_000 }).toMatch(/^v1\./);
    await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Join this Switchboard KC server" })).toBeHidden();
    const again = await request.post(`${BASE}/api/session`, { data: { code: inv.code } });
    expect(again.status()).toBe(403);
    await request.post(`${BASE}/api/admin/invites/revoke`, { headers: { "x-admin-token": OWNER }, data: { id: inv.id } });
    // A revoked invite ends its sessions.
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem("session")));
    await expect.poll(async () => (await request.post(`${BASE}/api/myissues`, { headers: { authorization: `Bearer ${token}` }, data: { device: TEST_DEVICE } })).status(),
      { timeout: 180_000, intervals: [15_000] }).toBe(401);
  });
});

test("report home, the four tabs, and settings", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Health and help/ })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  for (const [tab, title] of [["Services", "Services"], ["Reports", "Reports"], ["City", "City"], ["Report", "Switchboard KC"]]) {
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: tab, exact: true }).click();
    await expect(page.locator("#title")).toHaveText(title);
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const sheet = page.locator("#sheet");
  await expect(sheet.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(sheet.getByText(TEST_DEVICE)).toBeVisible();
  await expect(sheet.getByText("Working")).toBeVisible({ timeout: 20_000 });
  await sheet.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("body")).toHaveClass(/dark/);
  await sheet.getByLabel("Paste an id to restore").fill("not-an-id");
  await sheet.getByRole("button", { name: "Restore my reports" }).click();
  await expect(sheet.getByText("An id is 16 characters, 0 to 9 and a to f.")).toBeVisible();
  expect(await axe(page, "#sheet")).toEqual([]);
  await sheet.getByRole("button", { name: "Done" }).click();
  expect(await drawnIcons(page)).toEqual([]);
  expect(page.errors).toEqual([]);
});

test("file a pothole report: section, type, questions, location, send", async ({ context }) => {
  const { page, submits } = await ownerPage(context, { contact: { firstName: "Test", lastName: "Person", email: "test@example.com", phone: "" } });
  await page.goto("/#/services");
  await expect(page.getByRole("link", { name: /Streets & Sidewalks/ })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.getByRole("link", { name: /Streets & Sidewalks/ }).click();
  await page.getByRole("button", { name: "Pothole in the Street" }).click();
  await expect(page.locator("#title")).toHaveText("Details");
  await expect(page.getByText("Kansas City only repairs potholes")).toBeVisible();
  // The location fills from the device position and the city's address locator.
  await expect(page.locator("#loc")).toContainText("phone GPS", { timeout: 30_000 });
  await expect(page.locator("#loc")).toContainText(/\d+ [A-Z]/);
  await expect(page.locator("#rf-notes")).toHaveValue(/Location: GPS 39\.09/);
  await expect(page.locator("#send")).toContainText('Answer "Number of Potholes"');
  await page.getByRole("button", { name: "One pothole" }).click();
  await expect(page.locator("#send")).toContainText("Send to the city");
  expect(await axe(page)).toEqual([]);
  await page.locator("#send").click();
  await expect(sent(page)).toBeVisible();
  await expect(page.getByText("Report #123456")).toBeVisible();
  expect(submits).toHaveLength(1);
  const issue = issueFrom(submits[0]);
  expect(issue).toMatchObject({
    menu_id: "10871", type: "form_type", name: "A Pothole", subtype: "Pothole in the Street",
    form_data: { "Number of Potholes": "One pothole" }, share_options: "public",
    deviceuid: TEST_DEVICE, device_id: TEST_DEVICE, first_name: "Test", email: "test@example.com", api_version: "6.0",
  });
  expect(typeof issue.RAI_LAT).toBe("number");
  expect(issue.new_form_data[0]).toMatchObject({ caption: "Number of Potholes", type: 4, enterdValue: "One pothole" });
  expect(issue.SELECTED_SUB_TYPE[0]).toMatchObject({ subCat_id: "44019", Id: "44019", image: "" });
  expect(issue.RAI_STREET).toBeTruthy();
  expect(page.errors).toEqual([]);
});

test("the server checks a report but does not send it during a test run", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.unroute("**/api/submit");
  let reply = null;
  page.on("response", async (r) => { if (r.url().endsWith("/api/submit")) reply = await r.json(); });
  await potholeForm(page);
  await page.locator("#send").click();
  await expect(sent(page)).toBeVisible();
  expect(reply).toMatchObject({ ok: true, dry: true, work_order: "DRYRUN" });
});

test("a photo with GPS sets the location, and the photo goes in the zip", async ({ context }) => {
  const { page, submits } = await ownerPage(context);
  await page.goto("/");
  await page.locator("#rp-library").setInputFiles({ name: "pothole.jpg", mimeType: "image/jpeg", buffer: jpegWithGps(39.0937, -94.534) });
  await expect(page.locator("#title")).toHaveText("What is wrong?");
  await expect(page.getByRole("img", { name: "Your photo" })).toBeVisible();
  await page.getByLabel("Search report types, pages, and phone numbers").fill("pothole in the street");
  await page.getByRole("button", { name: /Pothole in the Street/ }).first().click();
  await expect(page.locator("#loc")).toContainText("photo GPS", { timeout: 30_000 });
  await page.getByRole("button", { name: "One pothole" }).click();
  await page.locator("#send").click();
  await expect(sent(page)).toBeVisible();
  const raw = submits[0].body.toString("latin1");
  expect(raw).toContain('name="file_zip"');
  const issue = issueFrom(submits[0]);
  expect(issue.files_metadata).toHaveLength(1);
  expect(issue.files_metadata[0].filename).toMatch(/^CAM\d+\.jpeg$/);
  expect(raw).toContain(issue.files_metadata[0].filename);
  expect(issue.RAI_LAT).toBeCloseTo(39.0937, 3);
});

test("the city's duplicate check: a warning asks first, a block stops the report", async ({ context }) => {
  const { page, submits } = await ownerPage(context, { duplicate: null });
  let level = "1";
  await page.route("**/api/duplicate", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, level, message: level === "2" ? "An issue has already been submitted of the same type and subtype at this address and cannot be submitted again." : "A similar issue was reported here." }) }));
  await potholeForm(page);
  await page.locator("#send").click();
  const sheet = page.locator("#sheet");
  await expect(sheet.getByRole("heading", { name: "Already reported here?" })).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  expect(submits).toHaveLength(0);
  level = "2";
  await page.locator("#send").click();
  await expect(page.locator("#err")).toContainText("cannot be submitted again");
  expect(submits).toHaveLength(0);
  level = "1";
  await page.locator("#send").click();
  await sheet.getByRole("button", { name: "Send anyway" }).click();
  await expect(sent(page)).toBeVisible();
  expect(submits).toHaveLength(1);
});

test("offline: the report waits in the queue and goes out when the server answers", async ({ context }) => {
  const { page, submits } = await ownerPage(context);
  await potholeForm(page);
  await page.unroute("**/api/submit");
  await page.route("**/api/submit", (r) => r.abort("internetdisconnected"));
  await page.locator("#send").click();
  await expect(page.getByRole("heading", { level: 2, name: /Saved/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Report", exact: true }).click();
  await expect(page.getByText("1 waiting to send")).toBeVisible();
  await page.unroute("**/api/submit");
  await page.route("**/api/submit", async (route) => {
    submits.push({ body: route.request().postDataBuffer() });
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"work_order":"222"}' });
  });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("1 waiting to send")).toBeHidden();
  expect(submits).toHaveLength(1);
  expect(issueFrom(submits[0]).subtype).toBe("Pothole in the Street");
});

test("reports: the public map loads pins, the list shows them, and a pin opens its detail", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/#/reports");
  await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#caption")).toContainText(/[1-9]\d* nearby/, { timeout: 60_000 });
  await page.getByRole("button", { name: "Show list" }).click();
  await expect(page.getByRole("heading", { name: "Nearby" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.locator("[data-pub]").first().click();
  const sheet = page.locator("#sheet");
  await expect(sheet.locator(".track")).toBeVisible();
  await expect(sheet.locator(".spinner")).toBeHidden({ timeout: 30_000 });
  expect(await sheet.textContent()).not.toMatch(/reporter_|@[\w-]+\.(com|net|org)/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Closed" }).click();
  await expect(page.getByRole("button", { name: "Closed" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show map" }).click();
  await expect(page.locator("#map canvas")).toBeVisible();
  expect(page.errors).toEqual([]);
});

test("my reports: a reports id with reports shows them, their detail, and the update rules", async ({ context }) => {
  // The id from a dry-run test report would be empty; use one that has real reports, read only.
  const { page } = await ownerPage(context, { device: process.env.READ_DEVICE || "36e84a199b185991" });
  await page.goto("/#/reports");
  await page.getByRole("button", { name: "Show list" }).click();
  await expect(page.getByRole("heading", { name: "Yours" })).toBeVisible({ timeout: 30_000 });
  await page.locator("#list a.tile").first().click();
  await expect(page.locator(".track")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible({ timeout: 30_000 });
  // Filed today: update requests are not open yet, and the button says when they open.
  await expect(page.getByRole("button", { name: "Request update" })).toBeDisabled();
  await expect(page.getByText(/Update requests open/)).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test("the owner gets past the invite screen with the owner token", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Join this Switchboard KC server" })).toBeVisible();
  await page.getByText("I run this server").click();
  await page.getByLabel("Owner token (ADMIN_TOKEN)").fill("wrong-token");
  await page.getByRole("button", { name: "Open as the owner" }).click();
  await expect(page.getByText("That token is not right.")).toBeVisible();
  await page.getByLabel("Owner token (ADMIN_TOKEN)").fill(OWNER);
  await page.getByRole("button", { name: "Open as the owner" }).click();
  await expect(page.getByRole("heading", { name: "Join this Switchboard KC server" })).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
});
