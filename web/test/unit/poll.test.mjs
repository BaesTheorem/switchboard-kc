// worker/push.js poll(): one minute's pass of the cron, with the city and the
// push service as stand-ins. The alert data is a real SQLite, the push is
// really encrypted, and the test decrypts it with the device's own keys (RFC
// 8291), as a browser does. So the ticket that the test reads is the one a
// device gets.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AlertStore } from "../../worker/alerts-store.js";
import { isAskFor, readTicket, TICKET_LIFE } from "../../worker/asks.js";
import { poll, QUIET } from "../../worker/push.js";

const DAY = 86400e3;
const UID = "0123456789abcdef";
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

/** A device: the keys of a push subscription, and the way to read a message sent to it. */
async function device(n, auto) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub = { endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: b64url(pub), auth: b64url(auth) }, added: n, auto };
  const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info },
    await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), bytes * 8));
  const text = (s) => new TextEncoder().encode(s);
  const read = async (body) => {
    const b = new Uint8Array(body);
    const salt = b.slice(0, 16), idlen = b[20], server = b.slice(21, 21 + idlen), data = b.slice(21 + idlen);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await crypto.subtle.importKey("raw", server, { name: "ECDH", namedCurve: "P-256" }, false, []) }, pair.privateKey, 256));
    const ikm = await hkdf(auth, shared, new Uint8Array([...text("WebPush: info\0"), ...pub, ...server]), 32);
    const key = await crypto.subtle.importKey("raw", await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16), "AES-GCM", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12) }, key, data));
    return JSON.parse(new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2))));
  };
  return { sub, read };
}

/** A Worker environment with a city that answers `rows` and a push service that takes each message. */
async function world(t, rows) {
  const db = new DatabaseSync(":memory:");
  const store = new AlertStore({ exec(query, ...args) {
    const st = db.prepare(query);
    const out = /^\s*(SELECT|UPDATE .* RETURNING)/is.test(query) ? st.all(...args) : (st.run(...args), []);
    return { toArray: () => out };
  } });
  const ledger = { alertBatch: (m) => store.batch(m), alertSave: (u, g, a) => store.save(u, g, a), alertImport: (s, st) => store.importOnce(s, st),
    alertRedeem: (u, r, e) => store.redeem(u, r, e) };
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const vapid = { publicKey: b64url(await crypto.subtle.exportKey("raw", pair.publicKey)), privateKey: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d };
  const kv = new Map([["civic:config", { key: "test-key", city_id: "c".repeat(32), app_version: "2025.020" }], ["cfg:vapid", vapid]]);
  const env = { KV: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, JSON.parse(v)); } }, LEDGER: { idFromName: () => "ledger", get: () => ledger } };
  const calls = { list: 0, detail: 0, pushes: [] };
  const w = { env, store, calls, vapid, rows };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (u.endsWith("/myissues")) { calls.list++; return json({ my_issues: w.rows, has_more: 0 }); }
    if (u.endsWith("/get_issue_detail_citizen")) {
      calls.detail++;
      const own = init.body.get("issue_id") === "9000001";
      return json({ response_code: 0, response_data: { issues: [{ id: init.body.get("issue_id"), added_on: own ? 1 : (NOW + 90e3) / 1000, history_object: (own ? w.history : w.requestHistory) || [] }] } });
    }
    if (u.startsWith("https://fcm.googleapis.com/")) { calls.pushes.push({ endpoint: u, body: init.body, ttl: new Headers(init.headers).get("ttl") }); return new Response("", { status: 201 }); }
    throw new Error(`unexpected call: ${u}`);
  });
  return w;
}

const NOW = Date.UTC(2026, 10, 12, 18, 0, 0);
const pothole = (over = {}) => ({ id: "9000001", name: "Streets and Sidewalks", subcategory: "Pothole in the Street", status: "Assigned",
  description: "A deep hole.", added_on: String((NOW - 10 * DAY) / 1000), updated_on: utc(NOW - 10 * DAY), ...over });

test("a due report: one ask a day, to the one device that sends update requests, with a ticket that the submit route takes", async (t) => {
  const w = await world(t, [pothole()]);
  const phone = await device(1, true), laptop = await device(2, false);
  w.store.subscribe(UID, phone.sub);
  w.store.subscribe(UID, laptop.sub);

  // The first look records what exists. It sends no alert and no ask.
  await poll(w.env, NOW);
  assert.equal(w.calls.pushes.length, 0);

  // The next minute: the report is due, and the ask goes to the phone only.
  const r = await poll(w.env, NOW + 60e3);
  assert.deepEqual(r, [{ uid: "0123", reports: 1, asked: 1 }]);
  assert.equal(w.calls.pushes.length, 1);
  assert.equal(w.calls.pushes[0].endpoint, phone.sub.endpoint);
  assert.equal(w.calls.pushes[0].ttl, String(TICKET_LIFE / 1000), "the push service drops an ask that is past its ticket");
  const m = await phone.read(w.calls.pushes[0].body);
  assert.deepEqual({ ...m, ticket: "" }, { type: "ask", report: "9000001", case: "", label: "Pothole in the Street", ticket: "",
    title: "Asked the city for an update", body: "Pothole in the Street had no updates in 7 days.", tag: "ask-9000001", url: "/#/reports/mine/9000001" });

  // The submit route's own checks take this ticket for this report, one time.
  const exp = await readTicket(w.vapid.privateKey, UID, m.report, m.case, m.ticket, NOW + 2 * 60e3);
  assert.equal(exp, NOW + 60e3 + TICKET_LIFE);
  assert.ok(isAskFor({ name: "311 Request Update", notes: "Please send an update on myKCMO app report 9000001: Pothole in the Street.", files_metadata: [] }, m.report, m.case));
  assert.equal(w.store.redeem(UID, m.report, exp), true);
  assert.equal(w.store.redeem(UID, m.report, exp), false);

  // No second ask in the same day, and one more a day later if the report is still due.
  for (let i = 2; i < 30; i++) await poll(w.env, NOW + i * 60e3);
  assert.equal(w.calls.pushes.length, 1);
  await poll(w.env, NOW + DAY + 2 * 60e3);
  assert.equal(w.calls.pushes.length, 2);
});

test("no ask: no device that sends update requests, a report that is not due, or a request that went out", async (t) => {
  const laptop = await device(2, false), phone = await device(1, true);
  // Alerts only.
  let w = await world(t, [pothole()]);
  w.store.subscribe(UID, laptop.sub);
  await poll(w.env, NOW);
  await poll(w.env, NOW + 60e3);
  assert.equal(w.calls.pushes.length, 0);
  t.mock.restoreAll();
  // Filed 3 days ago.
  w = await world(t, [pothole({ added_on: String((NOW - 3 * DAY) / 1000), updated_on: utc(NOW - 3 * DAY) })]);
  w.store.subscribe(UID, phone.sub);
  await poll(w.env, NOW);
  await poll(w.env, NOW + 60e3);
  assert.equal(w.calls.pushes.length, 0);
  t.mock.restoreAll();
  // The device sent the request: the id's list has it, so the report is not due for 7 days.
  w = await world(t, [pothole()]);
  w.store.subscribe(UID, phone.sub);
  await poll(w.env, NOW);
  await poll(w.env, NOW + 60e3);
  assert.equal(w.calls.pushes.length, 1);
  w.rows = [pothole(), { id: "9100001", name: "311 Request Update", status: "new", added_on: String((NOW + 90e3) / 1000), updated_on: utc(NOW + 90e3),
    description: "Please send an update on myKCMO app report 9000001: Pothole in the Street." }];
  await poll(w.env, NOW + DAY + 5 * 60e3);
  assert.equal(w.calls.pushes.length, 1, "no new ask, and no alert about the person's own request");
  // Staff answer the update request: that is news, under the report's name.
  w.requestHistory = [{ title: "Notes Added By staff", details: "A crew is scheduled.", timestamp: (NOW + DAY + 6 * 60e3) / 1000 }];
  w.rows = [w.rows[0], { ...w.rows[1], status: "resolved", updated_on: utc(NOW + DAY + 6 * 60e3) }];
  await poll(w.env, NOW + DAY + 7 * 60e3);
  assert.equal(w.calls.pushes.length, 2);
  const m = await phone.read(w.calls.pushes[1].body);
  assert.equal(m.type, undefined);
  assert.equal(m.title, "Pothole in the Street: now Assigned");
  assert.equal(m.body, "Update request 9100001: Notes Added By staff: A crew is scheduled.");
});

test("an update time that moves each minute costs one timeline read in QUIET minutes, and a status change is read at once", async (t) => {
  const w = await world(t, [pothole({ added_on: String((NOW - DAY) / 1000) })]);
  const laptop = await device(2, false);
  w.store.subscribe(UID, laptop.sub);
  w.history = [{ title: "Status Changed", details: "Status changed to Assigned", timestamp: (NOW - DAY) / 1000 }];
  await poll(w.env, NOW);
  assert.equal(w.calls.detail, 1, "the first look");
  for (let i = 1; i <= 60; i++) {
    w.rows = [pothole({ added_on: String((NOW - DAY) / 1000), updated_on: utc(NOW + i * 60e3) })];
    await poll(w.env, NOW + i * 60e3);
  }
  assert.equal(w.calls.list, 61);
  assert.equal(w.calls.detail, 1 + 60 / QUIET);
  assert.equal(w.calls.pushes.length, 0, "no new timeline entry, no alert");
  // Staff resolve the report: the next run reads the timeline and sends the alert.
  w.rows = [pothole({ added_on: String((NOW - DAY) / 1000), status: "Resolved", updated_on: utc(NOW + 61 * 60e3) })];
  w.history = [...w.history, { title: "Status Changed", details: "Status changed to Resolved", timestamp: (NOW + 61 * 60e3) / 1000 }];
  const before = w.calls.detail;
  await poll(w.env, NOW + 61 * 60e3);
  assert.equal(w.calls.detail, before + 1);
  assert.equal(w.calls.pushes.length, 1);
  const m = await laptop.read(w.calls.pushes[0].body);
  assert.equal(m.title, "Pothole in the Street: now Resolved");
  assert.equal(m.type, undefined);
});
