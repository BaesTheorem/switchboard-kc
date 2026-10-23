// End-to-end tests of the web app against a deployed server and the live city
// API. Nothing is filed: every test page sends the dry-run header, so the
// server checks a report and then does not pass it on, and helpers.mjs also
// answers /api/submit inside the page.

import { expect, test } from "@playwright/test";
import { axe, BASE, drawnIcons, issueFrom, jpegWithGps, KC, OWNER, ownerPage, TEST_DEVICE } from "./helpers.mjs";

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

test("a visitor with no token or invite opens the app and reads city data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  const r = await page.request.post(`${BASE}/api/myissues`, { data: { device: TEST_DEVICE } });
  expect(r.status()).toBe(200);
  expect(await axe(page)).toEqual([]);
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
  // Fixture data: a live id's reports change status (the old read-only id's reports all closed by 10/23/2026).
  const { page } = await ownerPage(context);
  const now = Math.floor(Date.now() / 1000);
  const row = { id: "9000002", name: "Sidewalks and Curbs", sub_type: "ADA Curb Issue", status: "received", description: "Mud on the curb ramp.",
    address: "1200 Oak St Kansas City MO 64106", latitude: String(KC.latitude), longitude: String(KC.longitude), added_on: String(now),
    updated_on: new Date(now * 1000).toISOString().slice(0, 19).replace("T", " ") };
  const issue = { status: "received", type: "Sidewalks and Curbs", subtype: "ADA Curb Issue", address: row.address, description: row.description,
    added_on: now, history_object: [{ title: "Notes Added By staff", details: "Sent for review.", dateofupdate: "10/23/2026 12:00 PM", timestamp: now }] };
  await page.route("**/api/myissues", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, my_issues: [row] }) }));
  await page.route("**/api/detail", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, issue }) }));
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

test("my reports: a note goes to the city only after the confirm, and the box clears", async ({ context }) => {
  // Fixture data only: the list, the detail and the note call are all answered here.
  const { page } = await ownerPage(context);
  const row = { id: "9000001", name: "Sidewalks and Curbs", sub_type: "ADA Curb Issue", status: "received", description: "Mud on the curb ramp.", address: "1 Test St", added_on: "1791241551" };
  let issue = { status: "received", type: "Sidewalks and Curbs", subtype: "ADA Curb Issue", address: "1 Test St", description: "Mud on the curb ramp.",
    citizen_allow_to_send_note: 1, history_object: [{ title: "Notes Added By staff", details: "Sent for review.", dateofupdate: "10/14/2026 01:36 PM", timestamp: 1791660960 }] };
  const notes = [];
  await page.route("**/api/myissues", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, my_issues: [row] }) }));
  await page.route("**/api/detail", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, issue }) }));
  await page.route("**/api/note", async (route) => {
    notes.push(JSON.parse(route.request().postData()));
    issue = { ...issue, history_object: [...issue.history_object,
      { title: "Notes Added By Citizen", details: notes.at(-1).text, dateofupdate: "10/23/2026 12:40 PM", timestamp: 1792777200 }] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, issue }) });
  });
  await page.goto("/#/reports/mine/9000001");
  await expect(page.getByRole("heading", { name: "Add a note" })).toBeVisible({ timeout: 30_000 });
  const send = page.getByRole("button", { name: "Send note" });
  await expect(send).toBeDisabled();
  await page.getByLabel("Note for staff").fill("The mud is still there.");
  await send.click();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(notes).toEqual([]);
  await send.click();
  await page.locator("#sheet").getByRole("button", { name: "Send note" }).click();
  await expect(page.getByText("Note sent")).toBeVisible();
  expect(notes).toEqual([{ device: TEST_DEVICE, id: "9000001", text: "The mud is still there." }]);
  await expect(page.getByLabel("Note for staff")).toHaveValue("");
  await expect(page.getByText("Notes Added By Citizen")).toBeVisible();
  expect(await axe(page)).toEqual([]);
});
