// The ledger: the daily report counts, in one Durable Object with SQLite
// storage. A Durable Object runs one request at a time, so "take one of
// today's report slots" is a single statement that two requests cannot both
// win. KV could not do this: it can serve a copy up to a minute old.

import { DurableObject } from "cloudflare:workers";

export class Ledger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // The server was invite-only until 2026-10-23; its invite records go.
    this.sql.exec("DROP TABLE IF EXISTS invites");
    this.sql.exec("CREATE TABLE IF NOT EXISTS counts (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)");
  }

  one(query, ...args) {
    return this.sql.exec(query, ...args).toArray()[0] || null;
  }

  /** Takes one slot if fewer than `max` are taken. True when it did. */
  reserve(k, max, exp) {
    return !!this.one(`INSERT INTO counts (k, n, exp) VALUES (?, 1, ?)
      ON CONFLICT(k) DO UPDATE SET n = n + 1 WHERE counts.n < ? RETURNING n`, k, exp, max);
  }

  refund(k) {
    this.sql.exec("UPDATE counts SET n = n - 1 WHERE k = ? AND n > 0", k);
  }

  sweep(now) {
    this.sql.exec("DELETE FROM counts WHERE exp < ?", now);
  }
}
