// An update request while the app is closed (worker/asks.js): the app keeps
// a filled request on the device, the server pushes an "ask" with a ticket,
// and the service worker sends the request and shows a notification.
//
// A local server gives out web/public and stands in for /api, so nothing in
// this test reaches the real server or the city. Only the report catalog is
// real: it is read one time from the deployed server, for the city's own
// update form. The push arrives through Chromium's debug protocol.

import { chromium, devices, expect, test } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, TEST_DEVICE } from "./helpers.mjs";

const pub = join(dirname(fileURLToPath(import.meta.url)), "../../public");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const DAY = 86400;

test("the app is closed: a push asks, the service worker sends the kept update request, and a notification says so", async ({ browserName }) => {
  test.skip(browserName !== "chromium", "The push arrives through Chromium's debug protocol.");
  // The full Chromium (its new headless mode, no window) takes a notification permission. The headless shell that the
  // other tests use says "denied" for each page, so this test starts its own browser.
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "allow", locale: "en-US", timezoneId: "America/Chicago" });
  const catalog = await (await fetch(`${BASE}/api/catalog`)).text();
  const now = Math.floor(Date.now() / 1000);
  const stamp = (t) => new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ");
  // One open report, filed 10 days ago, with no movement after that: due for an update request.
  const row = { id: "9000001", city_report_id: "9000001", name: "Streets and Sidewalks", sub_type: "Pothole in the Street", status: "Assigned",
    description: "A deep hole.", address: "1 Test St Kansas City MO 64106", added_on: String(now - 10 * DAY), updated_on: stamp(now - 10 * DAY), hasRated: "no" };
  const issue = { status: "Assigned", type: row.name, subtype: row.sub_type, address: row.address, description: row.description, added_on: now - 10 * DAY, history_object: [] };
  const got = { submits: [], subscribes: [] };
  let submitAnswer = { status: 200, body: { ok: true, message: "Report submitted", work_order: "555001" } };
  const part = (body, name) => new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`).exec(body)?.[1];

  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const json = (o, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
    if (path.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString("utf8");
      if (path === "/api/config") return json({ ok: true, app: "Switchboard KC", mode: "open", admin: false, vapid: "", turnstile: null, submitDaily: 10, city: "c".repeat(32) });
      if (path === "/api/health") return json({ ok: true, state: "ok", since: null, key: null });
      if (path === "/api/catalog") { res.writeHead(200, { "content-type": "application/json" }); return res.end(catalog); }
      if (path === "/api/myissues") return json({ ok: true, my_issues: [row] });
      if (path === "/api/detail") return json({ ok: true, issue });
      if (path === "/api/push/subscribe") { got.subscribes.push(JSON.parse(body)); return json({ ok: true }); }
      if (path === "/api/submit") {
        got.submits.push({ device: part(body, "device"), issue: JSON.parse(part(body, "issue_details")), ticket: part(body, "ticket"), report: part(body, "report"),
          caseNumber: part(body, "case"), turnstile: part(body, "turnstile"), dry: req.headers["x-kc311-dry-run"] });
        return json(submitAnswer.body, submitAnswer.status);
      }
      return json({ ok: false, error: "test", message: "no such call in this test" }, 503);
    }
    const file = join(pub, path === "/" ? "index.html" : decodeURIComponent(path));
    if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await context.grantPermissions(["notifications"]);
    await context.addInitScript(([dev]) => {
      const set = (k, v) => { if (localStorage.getItem(k) == null) localStorage.setItem(k, JSON.stringify(v)); };
      set("deviceUID", dev);
      set("contact", { firstName: "Test", lastName: "Person", email: "test@example.org", phone: "" });
      set("setupCardClosed", 1);
      // The app asked a moment ago, so it does not send this request itself when it opens. This test is about the closed app.
      set("autoAt", Date.now());
      // Alerts are on for this id. The push service is not part of this test: the subscription is a stand-in.
      set("alertsFor", dev);
      set("alertsChoice", "on");
      if (self.PushManager) {
        const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: "p", auth: "a" } };
        PushManager.prototype.getSubscription = async () => ({ ...sub, toJSON: () => sub, unsubscribe: async () => true });
      }
    }, [TEST_DEVICE]);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    let registrationId = "";
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => { for (const r of e.registrations) if (r.scopeURL.startsWith(base)) registrationId = r.registrationId; });
    await cdp.send("ServiceWorker.enable");

    await page.goto(`${base}/#/reports`);
    await expect(page.locator("#list a.tile").filter({ hasText: "Pothole in the Street" })).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await expect.poll(() => registrationId).not.toBe("");

    // The app keeps one filled update request for the open report on this device, and tells the server that this device sends them.
    const kept = () => page.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open("switchboard", 1);
      open.onsuccess = () => { const g = open.result.transaction("kv").objectStore("kv").get("asks"); g.onsuccess = () => resolve(g.result || null); };
      open.onerror = () => resolve(null);
    }));
    await expect.poll(async () => Object.keys((await kept()) || {}), { timeout: 30_000 }).toEqual(["9000001"]);
    const before = JSON.parse((await kept())["9000001"].issueJSON);
    expect(before.notes).toMatch(/^Please send an update on myKCMO app report 9000001: Pothole in the Street at 1 Test St/);
    expect(before.email).toBe("test@example.org");
    await expect.poll(() => got.subscribes.length).toBeGreaterThan(0);
    expect(got.subscribes.at(-1)).toMatchObject({ device: TEST_DEVICE, auto: true });
    expect(got.submits).toEqual([]);

    // The app closes. The push arrives.
    await page.goto("about:blank");
    const notes = async () => {
      const p = await context.newPage();
      await p.goto(`${base}/manifest.webmanifest`);
      const list = await p.evaluate(async () => (await (await navigator.serviceWorker.getRegistration("/")).getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data?.url })));
      await p.close();
      return list;
    };
    const push = (d) => cdp.send("ServiceWorker.deliverPushMessage", { origin: base, registrationId, data: JSON.stringify(d) });
    const ask = { type: "ask", report: "9000001", case: "", label: "Pothole in the Street", ticket: "1794530000000.test-ticket",
      title: "Asked the city for an update", body: "Pothole in the Street had no updates in 7 days.", tag: "ask-9000001", url: "/#/reports/mine/9000001" };
    const sentAt = Date.now();
    await push(ask);
    await expect.poll(() => got.submits.length, { timeout: 30_000 }).toBe(1);
    const s = got.submits[0];
    expect(s).toMatchObject({ device: TEST_DEVICE, ticket: ask.ticket, report: "9000001", caseNumber: "" });
    expect(s.turnstile).toBeUndefined();
    // The kept request, with the time of the send, and the contact details that the form needs.
    expect(s.issue.notes).toBe(before.notes);
    expect(s.issue.email).toBe("test@example.org");
    expect(s.issue.deviceuid).toBe(TEST_DEVICE);
    expect(Number(s.issue.timestamp)).toBeGreaterThanOrEqual(sentAt);
    expect(s.issue.offline_timestamp).toBeGreaterThanOrEqual(sentAt);
    expect(/request update/i.test(s.issue.name)).toBe(true);
    await expect.poll(notes).toEqual([{ title: "Asked the city for an update", body: "Pothole in the Street had no updates in 7 days.", tag: "ask-9000001", url: "/#/reports/mine/9000001" }]);

    // The server refuses the ticket (past its time): the notification asks the person to open the app.
    submitAnswer = { status: 403, body: { ok: false, error: "bad_ticket", message: "This update request is past its time. Open the app to send it." } };
    await push(ask);
    await expect.poll(() => got.submits.length, { timeout: 30_000 }).toBe(2);
    await expect.poll(notes).toEqual([{ title: "Time to ask the city for an update", body: "Pothole in the Street had no updates in 7 days. Open the app to send the request.", tag: "ask-9000001", url: "/#/reports/mine/9000001" }]);

    // A report with no kept request: nothing goes out, and the notification still shows.
    await push({ ...ask, report: "9000002", label: "Missed Trash", tag: "ask-9000002", url: "/#/reports/mine/9000002" });
    await expect.poll(async () => (await notes()).map((n) => n.tag).sort()).toEqual(["ask-9000001", "ask-9000002"]);
    expect(got.submits.length).toBe(2);

    // A report alert (no type) shows as before.
    await push({ title: "Pothole in the Street: now Resolved", body: "Status Changed", tag: "report-9000001", url: "/#/reports/mine/9000001" });
    await expect.poll(async () => (await notes()).map((n) => n.tag).sort()).toEqual(["ask-9000001", "ask-9000002", "report-9000001"]);
    expect(got.submits.length).toBe(2);
  } finally {
    server.close();
    await browser.close();
  }
});
