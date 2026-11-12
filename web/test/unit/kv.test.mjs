// The Worker's KV writes for caches and status flags (worker/util.js softPut).
// Cloudflare's free plan stops KV writes after 1,000 a day for the account;
// put() then throws until 00:00 UTC. A read must still answer.

import assert from "node:assert/strict";
import test from "node:test";
import { markKey } from "../../worker/civic.js";
import { softPut } from "../../worker/util.js";

const overLimit = () => { throw new Error("KV PUT failed: 429 Too Many Requests"); };

test("softPut writes and reports it", async () => {
  const saved = [];
  const env = { KV: { put: async (...a) => { saved.push(a); } } };
  assert.equal(await softPut(env, "cache:x", "1", { expirationTtl: 60 }), true);
  assert.deepEqual(saved, [["cache:x", "1", { expirationTtl: 60 }]]);
});

test("softPut does not throw when the account is over its daily writes", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.equal(await softPut({ KV: { put: overLimit } }, "cache:x", "1"), false);
});

test("markKey does not fail a request when its status write is refused", async (t) => {
  t.mock.method(console, "warn", () => {});
  await markKey({ KV: { get: async () => null, put: overLimit } }, "rejected");
});
