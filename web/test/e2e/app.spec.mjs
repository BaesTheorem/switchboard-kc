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

test("report home, the five tabs, and settings", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Report a problem" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Take a photo" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Health and help/ })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  for (const [tab, title] of [["Services", "Services"], ["Reports", "Reports"], ["Meetings", "City meetings"], ["City", "City"], ["Report", "Switchboard KC"]]) {
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: tab, exact: true }).click();
    await expect(page.locator("#title")).toHaveText(title);
  }
  await page.getByRole("button", { name: "Settings" }).click();
  const sheet = page.locator("#sheet");
  await expect(sheet.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(sheet.getByText(TEST_DEVICE)).toBeVisible();
  await expect(sheet.getByText("Working")).toBeVisible({ timeout: 20_000 });
  // Details shows how long this start took, and where the time went.
  await expect(sheet.getByText("Last start")).toBeVisible();
  await expect(sheet.getByText(/first screen \d+\.\d s/)).toBeVisible();
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

test("the five tabs fit a 320 px screen (an iPhone with Display Zoom)", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.setViewportSize({ width: 320, height: 693 });
  await page.goto("/#/meetings");   // the longest label, in its bold (selected) form
  await expect(page.locator("#title")).toHaveText("City meetings");
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(() => {
    const nav = document.querySelector("nav#tabs");
    const tabs = [...nav.querySelectorAll("a")];
    return { bar: nav.scrollWidth - nav.clientWidth, right: Math.max(...tabs.map((a) => a.getBoundingClientRect().right)),
      label: Math.max(...tabs.map((a) => a.scrollWidth - a.clientWidth)), count: tabs.length };
  });
  expect(m).toEqual({ bar: 0, right: 320, label: 0, count: 5 });
});

test("home: no trash day before an address is set, and the setup card asks for the address and the contact details", async ({ context }) => {
  const { page } = await ownerPage(context);   // the position is allowed and known, as on a phone that said yes
  let lookups = 0;
  page.on("request", (r) => { if (r.url().includes("mapd.kcmo.org")) lookups++; });
  await page.goto("/");
  const setup = page.locator("section.card", { has: page.getByRole("heading", { name: "Set your address and contact details" }) });
  await expect(setup).toContainText("This app stores both on this device only.");
  // The device's position alone shows nothing: the trash day there can be another street's.
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#near")).toBeEmpty();
  expect(lookups).toBe(0);
  expect(await axe(page)).toEqual([]);
  await setup.getByRole("button", { name: "Set your address" }).click();
  const picker = page.locator(".picker");
  await expect(picker.locator("#pk-addr")).not.toHaveText(/Move the map|Finding/, { timeout: 30_000 });
  const street = await picker.locator("#pk-addr").textContent();
  await picker.getByRole("button", { name: "Use this spot" }).click();
  const near = page.locator("#near");
  await expect(near.getByRole("heading", { name: street })).toBeVisible();
  await expect(near).toContainText(/Trash day: \w+day/, { timeout: 30_000 });
  await expect(setup).toContainText(`Address: ${street}`);
  await setup.getByRole("button", { name: "Add your contact details" }).click();
  const sheet = page.locator("#sheet");
  await sheet.getByLabel("First name").fill("Test");
  await sheet.getByLabel("Email").fill("test@example.com");
  await expect(sheet).toHaveCSS("opacity", "1");   // the sheet fades in, and a contrast check in the fade reads pale text
  expect(await axe(page, "#sheet")).toEqual([]);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(setup).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("contact")))).toMatchObject({ firstName: "Test", email: "test@example.com" });
  // Settings holds both, to change later.
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(sheet.getByRole("button", { name: /Home address/ })).toContainText(street);
  await expect(sheet.getByRole("button", { name: /Contact details/ })).toContainText("Test · test@example.com");
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

test("the form shows the open reports of the same type near the spot, and one opens its detail", async ({ context }) => {
  const { page } = await ownerPage(context);
  const now = Math.floor(Date.now() / 1000);
  const pin = (id, subtype, north, address) => ({ report_id: id, issue_name: "A Pothole", subtype, issue_status: "received", issue_address: address,
    issue_latitude: String(KC.latitude + north), issue_longitude: String(KC.longitude), issue_submitted_date: String(now - 3 * 86400), issue_description: "Deep hole in the right lane." });
  let asked = null;
  await page.route("**/api/map", (route) => {
    asked = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, response_status: { response_data: [
      pin("9100002", "Pothole in the Street", 0.0009, "1100 Main St Kansas City MO 64105"),      // about 100 m
      pin("9100001", "Pothole in the Street", 0.00027, "1201 Main St Kansas City MO 64105"),     // about 30 m
      pin("9100003", "Pothole in the Street", 0.0036, "800 Main St Kansas City MO 64105"),       // about 400 m: too far
      pin("9100004", "Pothole in the Alley", 0.0002, "1200 Baltimore Ave Kansas City MO 64105"), // another type
    ] } }) });
  });
  await page.route("**/api/detail", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, issue: {
    status: "received", type: "A Pothole", subtype: "Pothole in the Street", address: "1201 Main St Kansas City MO 64105", description: "Deep hole in the right lane.", added_on: now - 3 * 86400, history_object: [] } }) }));
  await page.goto("/#/services");
  await page.getByRole("link", { name: /Streets & Sidewalks/ }).click();
  await page.getByRole("button", { name: "Pothole in the Street" }).click();
  const near = page.getByRole("region", { name: "Open reports of this type near this spot" });
  await expect(near).toContainText("2 open reports of this type within 500 feet.", { timeout: 30_000 });
  // One city call, for this category only, at the spot. The nearest report is first.
  expect(asked.types).toHaveLength(1);
  expect(asked.status).toBe("open");
  await expect(near.locator("[data-near]")).toHaveCount(2);
  await expect(near.locator("[data-near]").first()).toContainText("1201 Main St");
  expect(await axe(page)).toEqual([]);
  await near.locator("[data-near]").first().click();
  await expect(page.locator("#sheet .track")).toBeVisible();
  await page.keyboard.press("Escape");
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

test("reports: an id with no reports sees everyone's list, a row opens its detail, and the map draws the pins", async ({ context }) => {
  const { page } = await ownerPage(context);
  await page.goto("/#/reports");
  // The tab opens on the list. "Only mine" has nothing to show for this id, so the list is everyone's open reports.
  await expect(page.getByRole("heading", { name: "Nearby" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#only")).toHaveCount(0);
  await expect(page.locator("#caption")).toContainText(/[1-9]\d* nearby/, { timeout: 60_000 });
  expect(await axe(page)).toEqual([]);
  // The pins land in groups and each group draws the list again. A redraw between the press and the release must not lose the tap.
  const box = await page.locator("[data-pub]").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(async () => (await import("/js/state.js")).emit("map"));
  await page.mouse.up();
  const sheet = page.locator("#sheet");
  await expect(sheet.locator(".track")).toBeVisible();
  await expect(sheet.locator(".spinner")).toBeHidden({ timeout: 30_000 });
  expect(await sheet.textContent()).not.toMatch(/reporter_|@[\w-]+\.(com|net|org)/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Closed" }).click();
  await expect(page.getByRole("button", { name: "Closed" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Show map" }).click();
  await expect(page.locator("#map canvas")).toBeVisible({ timeout: 30_000 });
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
  let mapCalls = 0;
  await page.route("**/api/map", (route) => {
    mapCalls++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, response_status: { response_data: [] } }) });
  });
  await page.goto("/#/reports");
  // The tab opens on the list of this id's reports, open and closed, and it does not ask the city for everyone's pins.
  await expect(page.getByRole("heading", { name: "Yours" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#only")).toContainText("Only mine");
  await expect(page.getByRole("heading", { name: "Nearby" })).toHaveCount(0);
  await expect(page.locator("#caption")).toHaveText("Past 1 year · 1 yours");
  expect(mapCalls).toBe(0);
  // "Everyone" adds the public reports, with their own status (Open), and "Only mine" takes them away again.
  await page.locator("#only").click();
  await expect(page.getByRole("heading", { name: "Nearby" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => mapCalls).toBeGreaterThan(0);
  await page.locator("#only").click();
  await expect(page.getByRole("heading", { name: "Nearby" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "true");
  // A status with no match says so.
  await page.getByRole("button", { name: "Closed", exact: true }).click();
  await expect(page.getByText("None of your reports are closed")).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
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

test("my reports: a closed report takes one rating, and it goes to the city only after the confirm", async ({ context }) => {
  // Fixture data only: the list, the detail and the rating call are all answered here.
  const { page } = await ownerPage(context);
  const now = Math.floor(Date.now() / 1000);
  let closed = { id: "9000003", city_report_id: "9000003", name: "Trash  Recycling  Bulky Services", sub_type: "Missed Trash", status: "Resolved",
    description: "The trash is still at the curb.", address: "1 Test St", added_on: String(now - 3 * 86400), hasRated: "no", ratingValue: 0 };
  const open = { ...closed, id: "9000004", city_report_id: "9000004", name: "Streets and Sidewalks", sub_type: "Pothole in the Street", status: "Assigned" };
  const issue = (r) => ({ status: r.status, type: r.name, subtype: r.sub_type, address: r.address, description: r.description, citizen_allow_to_send_note: 0,
    history_object: [{ title: "Status Changed", details: `Status changed to ${r.status}`, dateofupdate: "11/10/2026 01:08 PM", timestamp: now - 86400 }] });
  const ratings = [];
  await page.route("**/api/myissues", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, my_issues: [closed, open] }) }));
  await page.route("**/api/detail", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, issue: issue(route.request().postDataJSON().id === open.id ? open : closed) }) }));
  await page.route("**/api/rate", async (route) => {
    ratings.push(route.request().postDataJSON());
    closed = { ...closed, hasRated: "yes", ratingValue: ratings.at(-1).rating };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "Thank you for your feedback." }) });
  });
  // The card of the closed report asks for a rating. The card of the open report does not.
  await page.goto("/#/reports");
  await expect(page.locator("#list a.tile").filter({ hasText: "Missed Trash" })).toContainText("Rate the city's work", { timeout: 30_000 });
  await expect(page.locator("#list a.tile").filter({ hasText: "Pothole" })).not.toContainText("Rate the city's work");
  await page.goto("/#/reports/mine/9000004");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Rate the city's work" })).toHaveCount(0);
  await page.goto("/#/reports/mine/9000003");
  await expect(page.getByRole("heading", { name: "Rate the city's work" })).toBeVisible({ timeout: 30_000 });
  const send = page.getByRole("button", { name: "Send rating" });
  await expect(send).toBeDisabled();
  await expect(page.getByRole("radio")).toHaveCount(5);
  expect(await axe(page)).toEqual([]);
  expect(await drawnIcons(page)).toEqual([]);
  // A tap on the fourth star sets four. Each star is a tap target of 44 px or more.
  await page.locator('label[for="star-4"]').click();
  await expect(page.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await expect(page.locator(".stars label.on")).toHaveCount(4);
  expect(await page.locator(".stars label.star").evaluateAll((ls) => ls.every((l) => l.offsetWidth >= 44 && l.offsetHeight >= 44))).toBe(true);
  // The arrow keys move the rating, as in each radio group, and the focus stays on the stars.
  await page.getByRole("radio", { name: "4 stars" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "5 stars" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "5 stars" })).toBeFocused();
  await expect(page.locator(".stars label.on")).toHaveCount(5);
  await page.getByLabel("Comment for the city (optional)").fill("Fast work.");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator("#sheet")).toContainText("Send 5 stars to the city?");
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(ratings).toEqual([]);
  await send.click();
  await page.locator("#sheet").getByRole("button", { name: "Send rating" }).click();
  await expect(page.getByRole("heading", { name: "Your rating" })).toBeVisible();
  expect(ratings).toEqual([{ device: TEST_DEVICE, id: "9000003", rating: 5, text: "Fast work." }]);
  await expect(page.getByRole("img", { name: "5 of 5 stars" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send rating" })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await page.locator("#sheet").evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished))).catch(() => {});
  expect(await axe(page)).toEqual([]);
  // The list card shows the rating that the report has.
  await page.goto("/#/reports");
  await expect(page.locator("#list a.tile").filter({ hasText: "Missed Trash" })).toContainText("You gave 5 of 5 stars");
  expect(page.errors).toEqual([]);
});
