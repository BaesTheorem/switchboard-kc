// worker/alerts-store.js: the alert data as rows, over a real SQLite (Node's
// own), with the same `exec(...).toArray()` shape as a Durable Object's.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AlertStore, SLICE } from "../../worker/alerts-store.js";

function store() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query, ...args) {
    const st = db.prepare(query);
    const rows = /^\s*(SELECT|UPDATE .* RETURNING)/is.test(query) ? st.all(...args) : (st.run(...args), []);
    return { toArray: () => rows };
  } };
  return new AlertStore(sql);
}
const sub = (n, added = n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` }, added });
const id = (n) => n.toString(16).padStart(16, "0");

test("subscribe keeps one row for an endpoint, and the newest five for an id", () => {
  const s = store();
  s.subscribe(id(1), sub(1));
  s.subscribe(id(1), { ...sub(1), keys: { p256dh: "new", auth: "new" } });
  assert.deepEqual(s.subsFor(id(1)).map((x) => x.keys.p256dh), ["new"]);
  for (let n = 2; n <= 7; n++) s.subscribe(id(1), sub(n));
  assert.deepEqual(s.subsFor(id(1)).map((x) => x.added), [3, 4, 5, 6, 7]);
  assert.deepEqual(s.stats(), { ids: 1, endpoints: 5, reports: 0 });
});

test("a restore moves the subscription to the new id", () => {
  const s = store();
  s.subscribe(id(1), sub(1));
  s.save([{ uid: id(1), seen: { 9000001: { sig: "x", keys: ["k"] } } }]);
  s.subscribe(id(2), sub(1), id(1));
  assert.deepEqual(s.subsFor(id(1)), []);
  assert.equal(s.subsFor(id(2)).length, 1);
  // The old id keeps nothing, and the new one starts from a first look.
  assert.deepEqual(s.stats(), { ids: 1, endpoints: 1, reports: 0 });
  assert.equal(s.batch(0).batch[0].seeded, false);
});

test("the last unsubscribe of an id removes what was seen", () => {
  const s = store();
  s.subscribe(id(1), sub(1));
  s.subscribe(id(1), sub(2));
  s.save([{ uid: id(1), seen: { 9000001: { sig: "x", keys: ["k"] } } }]);
  s.unsubscribe(id(1), sub(1).endpoint);
  assert.equal(s.stats().reports, 1);
  s.unsubscribe(id(1), sub(2).endpoint);
  assert.deepEqual(s.stats(), { ids: 0, endpoints: 0, reports: 0 });
});

test("batch gives each id its subscriptions and what was seen, and says if the first look is done", () => {
  const s = store();
  s.subscribe(id(1), sub(1));
  let b = s.batch(0);
  assert.equal(b.total, 1);
  assert.deepEqual(b.batch, [{ uid: id(1), subs: [{ ...sub(1), auto: false }], seeded: false, seen: {}, asked: {} }]);
  s.save([{ uid: id(1), seen: {} }]);   // the first look found no reports
  assert.equal(s.batch(0).batch[0].seeded, true);
  s.save([{ uid: id(1), seen: { 9000001: { sig: "9000001:received|2026-11-12 10:00:00", keys: ["1|Notes"] } } }]);
  s.save([{ uid: id(1), seen: { 9000001: { sig: "9000001:resolved|2026-11-13 09:00:00", keys: ["1|Notes", "2|Closed"] } } }]);
  b = s.batch(0);
  assert.deepEqual(b.batch[0].seen, { 9000001: { sig: "9000001:resolved|2026-11-13 09:00:00", keys: ["1|Notes", "2|Closed"], at: 0 } });
  // The minute of the look is kept with the report.
  s.save([{ uid: id(1), seen: { 9000001: { sig: "x", keys: [], at: 29700000 } } }]);
  assert.equal(s.batch(0).batch[0].seen[9000001].at, 29700000);
});

test("a subscription keeps the mark of a device that sends update requests, and a new subscribe call changes it", () => {
  const s = store();
  s.subscribe(id(1), { ...sub(1), auto: true });
  s.subscribe(id(1), sub(2));
  assert.deepEqual(s.subsFor(id(1)).map((x) => x.auto), [true, false]);
  s.subscribe(id(1), { ...sub(1), auto: false });
  assert.deepEqual(s.subsFor(id(1)).map((x) => x.auto), [false, false]);
});

test("an ask is kept with its ticket time, and the ticket works one time", () => {
  const s = store();
  s.subscribe(id(1), { ...sub(1), auto: true });
  s.save([], [], [{ uid: id(1), report: "9000001", at: 1000, exp: 2000 }]);
  assert.deepEqual(s.batch(0).batch[0].asked, { 9000001: 1000 });
  // A ticket that the server did not give: another report, another id, another time.
  assert.equal(s.redeem(id(1), "9000002", 2000), false);
  assert.equal(s.redeem(id(2), "9000001", 2000), false);
  assert.equal(s.redeem(id(1), "9000001", 2001), false);
  assert.equal(s.redeem(id(1), "9000001", 2000), true);
  assert.equal(s.redeem(id(1), "9000001", 2000), false, "one time");
  // The request did not reach the city: the ticket works again.
  s.release(id(1), "9000001", 2000);
  assert.equal(s.redeem(id(1), "9000001", 2000), true);
  // The next ask for the same report gives a new ticket and ends the old one.
  s.save([], [], [{ uid: id(1), report: "9000001", at: 90000000, exp: 90900000 }]);
  assert.equal(s.redeem(id(1), "9000001", 2000), false);
  assert.equal(s.redeem(id(1), "9000001", 90900000), true);
  // An ask for an id with no subscription is not kept, and an unsubscribe removes the asks.
  s.save([], [], [{ uid: id(9), report: "9000009", at: 1, exp: 2 }]);
  assert.equal(s.redeem(id(9), "9000009", 2), false);
  s.unsubscribe(id(1), sub(1).endpoint);
  assert.equal(s.redeem(id(1), "9000001", 90900000), false);
});

test("a store made before 2026-11-12 gets the two new columns and keeps its rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE push_subs (uid TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, added INTEGER NOT NULL, PRIMARY KEY (uid, endpoint))");
  db.exec("CREATE TABLE push_ids (uid TEXT PRIMARY KEY, seeded INTEGER NOT NULL DEFAULT 0)");
  db.exec("CREATE TABLE push_seen (uid TEXT NOT NULL, report TEXT NOT NULL, sig TEXT NOT NULL, keys TEXT NOT NULL, PRIMARY KEY (uid, report))");
  db.prepare("INSERT INTO push_subs VALUES (?, ?, ?, ?, ?)").run(id(1), sub(1).endpoint, "p1", "a1", 1);
  db.prepare("INSERT INTO push_ids VALUES (?, 1)").run(id(1));
  db.prepare("INSERT INTO push_seen VALUES (?, ?, ?, ?)").run(id(1), "9000001", "old", '["k"]');
  const sql = { exec(query, ...args) {
    const st = db.prepare(query);
    const rows = /^\s*(SELECT|UPDATE .* RETURNING)/is.test(query) ? st.all(...args) : (st.run(...args), []);
    return { toArray: () => rows };
  } };
  const s = new AlertStore(sql);
  assert.deepEqual(s.batch(0).batch[0], { uid: id(1), subs: [{ ...sub(1), auto: false }], seeded: true, seen: { 9000001: { sig: "old", keys: ["k"], at: 0 } }, asked: {} });
  // A second start finds the columns and changes nothing.
  assert.deepEqual(new AlertStore(sql).stats(), { ids: 1, endpoints: 1, reports: 1 });
});

test("with more ids than one run takes, the ids take turns and each id gets its turn", () => {
  const s = store();
  for (let n = 1; n <= 40; n++) s.subscribe(id(n), sub(n));
  const turns = [0, 1, 2].map((m) => s.batch(1000 + m).batch.map((x) => x.uid));
  for (const t of turns) assert.ok(t.length <= SLICE, `${t.length} ids in one run`);
  assert.deepEqual([...turns.flat()].sort(), Array.from({ length: 40 }, (_, i) => id(i + 1)).sort());
  assert.equal(new Set(turns.flat()).size, 40, "no id two times in one round");
  // Up to SLICE ids: all of them in each minute.
  const few = store();
  for (let n = 1; n <= SLICE; n++) few.subscribe(id(n), sub(n));
  assert.equal(few.batch(7).batch.length, SLICE);
  assert.equal(few.batch(8).batch.length, SLICE);
});

test("save drops a subscription that the push service removed, and skips an id that unsubscribed in the meantime", () => {
  const s = store();
  s.subscribe(id(1), sub(1));
  s.subscribe(id(2), sub(2));
  s.unsubscribe(id(2), sub(2).endpoint);
  s.save([{ uid: id(2), seen: { 9000002: { sig: "x", keys: [] } } }], [[id(1), sub(1).endpoint]]);
  assert.deepEqual(s.stats(), { ids: 0, endpoints: 0, reports: 0 });
});

test("the move from KV runs one time, keeps a finished first look, and leaves out ids with no subscription", () => {
  const s = store();
  assert.equal(s.batch(0).imported, false);
  const subs = { [id(1)]: [sub(1)], [id(2)]: [sub(2)] };
  const state = {
    [id(1)]: { seeded: true, seen: { 9000001: { sig: "a", keys: ["k1"] }, 9000002: { sig: "b", keys: [] } } },
    [id(2)]: { seeded: false, seen: {} },
    [id(3)]: { seeded: true, seen: { 9000003: { sig: "c", keys: [] } } },   // an id that turned alerts off
  };
  assert.equal(s.importOnce(subs, state), true);
  assert.deepEqual(s.stats(), { ids: 2, endpoints: 2, reports: 2 });
  const b = s.batch(0);
  assert.equal(b.imported, true);
  assert.deepEqual(b.batch.map((x) => [x.uid, x.seeded, Object.keys(x.seen).length]), [[id(1), true, 2], [id(2), false, 0]]);
  assert.equal(s.importOnce({ [id(9)]: [sub(9)] }, {}), false);
  assert.equal(s.stats().ids, 2);
});
