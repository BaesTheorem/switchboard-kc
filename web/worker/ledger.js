// The ledger: invites and the daily report counts, in one Durable Object
// with SQLite storage. A Durable Object runs one request at a time, so "use
// one of this invite's uses" and "take one of today's report slots" are each
// a single statement that two requests cannot both win. KV could not do this:
// it can serve a copy up to a minute old, which let a one-use invite be
// redeemed twice.

import { DurableObject } from "cloudflare:workers";

export class Ledger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, label TEXT NOT NULL, max INTEGER NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, hint TEXT, last INTEGER)`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS counts (k TEXT PRIMARY KEY, n INTEGER NOT NULL, exp INTEGER NOT NULL)");
    // Invites made before the ledger existed were kept in KV: copy them in once.
    ctx.blockConcurrencyWhile(async () => {
      if (ctx.storage.kv?.get?.("kv_imported") || this.one("SELECT 1 AS x FROM invites LIMIT 1")) return;
      let cursor;
      do {
        const page = await env.KV.list({ prefix: "inv:", cursor });
        for (const k of page.keys) {
          const r = await env.KV.get(k.name, "json");
          if (r) this.sql.exec("INSERT OR IGNORE INTO invites (hash, label, max, uses, created, revoked, hint, last) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            k.name.slice(4), r.label || "Invite", r.max || 1, r.uses || 0, r.created || Date.now(), r.revoked ? 1 : 0, r.hint || "", r.last ?? null);
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      ctx.storage.kv?.put?.("kv_imported", Date.now());
    });
  }

  one(query, ...args) {
    return this.sql.exec(query, ...args).toArray()[0] || null;
  }

  invite(hash) {
    return this.one("SELECT label, revoked FROM invites WHERE hash = ?", hash);
  }

  create(rec) {
    this.sql.exec("INSERT INTO invites (hash, label, max, uses, created, revoked, hint) VALUES (?, ?, ?, 0, ?, 0, ?)",
      rec.hash, rec.label, rec.max, rec.created, rec.hint);
  }

  list() {
    return this.sql.exec("SELECT * FROM invites ORDER BY created DESC").toArray();
  }

  revoke(prefix) {
    return this.sql.exec("UPDATE invites SET revoked = 1 WHERE substr(hash, 1, 16) = ?", prefix).rowsWritten;
  }

  /** "ok" with the label, or why not: "bad" (no such invite, or revoked) or "used". */
  redeem(hash, now) {
    const done = this.sql.exec("UPDATE invites SET uses = uses + 1, last = ? WHERE hash = ? AND revoked = 0 AND uses < max", now, hash).rowsWritten;
    const row = this.one("SELECT label, revoked FROM invites WHERE hash = ?", hash);
    if (done) return { ok: true, label: row.label };
    return { ok: false, why: !row || row.revoked ? "bad" : "used" };
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
