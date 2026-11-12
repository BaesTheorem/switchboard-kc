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
    const rows = /^\s*SELECT/i.test(query) ? st.all(...args) : (st.run(...args), []);
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
  assert.deepEqual(b.batch, [{ uid: id(1), subs: [sub(1)], seeded: false, seen: {} }]);
  s.save([{ uid: id(1), seen: {} }]);   // the first look found no reports
  assert.equal(s.batch(0).batch[0].seeded, true);
  s.save([{ uid: id(1), seen: { 9000001: { sig: "9000001:received|2026-11-12 10:00:00", keys: ["1|Notes"] } } }]);
  s.save([{ uid: id(1), seen: { 9000001: { sig: "9000001:resolved|2026-11-13 09:00:00", keys: ["1|Notes", "2|Closed"] } } }]);
  b = s.batch(0);
  assert.deepEqual(b.batch[0].seen, { 9000001: { sig: "9000001:resolved|2026-11-13 09:00:00", keys: ["1|Notes", "2|Closed"] } });
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
