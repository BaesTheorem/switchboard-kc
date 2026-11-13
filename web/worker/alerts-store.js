// Where ticket alerts keep their data: the push subscriptions of each reports
// id, and what the cron saw last for each report. Rows in the ledger's SQLite
// (ledger.js), one for each subscription and one for each report.
//
// Until 2026-11-12 this was two JSON values in KV for all people together.
// The cron read and parsed both each minute and wrote one back, so the cost
// grew with the number of people: the free plan gives a run 10 ms of
// processor time, and the account 1,000 KV writes a day. Now a run reads the
// rows of the ids it checks, and writes only the rows that changed.
//
// Two more things are here for the update requests that a device sends when
// its app is closed (asks.js): which subscriptions can do that (`auto`), and
// when the server last asked for each report (push_asks).
//
// Nothing here holds report text, addresses, or contact data.

/** Ids for each run. Each id costs one city call or more, and a run has 50 calls out on the free plan. */
export const SLICE = 15;

const toSub = (r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth }, added: r.added, auto: !!r.auto });

export class AlertStore {
  /** `sql` is a Durable Object's `ctx.storage.sql` (or the same interface over another SQLite, in the tests). */
  constructor(sql) {
    this.sql = sql;
    sql.exec("CREATE TABLE IF NOT EXISTS push_subs (uid TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, added INTEGER NOT NULL, PRIMARY KEY (uid, endpoint))");
    sql.exec("CREATE TABLE IF NOT EXISTS push_ids (uid TEXT PRIMARY KEY, seeded INTEGER NOT NULL DEFAULT 0)");
    sql.exec("CREATE TABLE IF NOT EXISTS push_seen (uid TEXT NOT NULL, report TEXT NOT NULL, sig TEXT NOT NULL, keys TEXT NOT NULL, PRIMARY KEY (uid, report))");
    sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS push_asks (uid TEXT NOT NULL, report TEXT NOT NULL, at INTEGER NOT NULL, exp INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (uid, report))");
    // Columns added on 2026-11-12, for stores made before that day.
    this.column("push_subs", "auto", "INTEGER NOT NULL DEFAULT 0");   // 1: this device sends update requests when its app is closed
    this.column("push_seen", "at", "INTEGER NOT NULL DEFAULT 0");     // the minute of the last look at the report's timeline
  }

  column(table, name, type) {
    try { this.sql.exec(`SELECT ${name} FROM ${table} LIMIT 0`); } catch { this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); }
  }

  rows(query, ...args) {
    return this.sql.exec(query, ...args).toArray();
  }

  has(uid) {
    return this.rows("SELECT 1 AS x FROM push_subs WHERE uid = ? LIMIT 1", uid).length > 0;
  }

  /**
   * Adds a subscription to an id and keeps the newest five. `prior` is the id this browser had before a restore.
   * `sub.auto` says that the device keeps filled update requests and can send one when the server asks.
   */
  subscribe(uid, sub, prior = "") {
    if (prior && prior !== uid) this.unsubscribe(prior, sub.endpoint);
    this.sql.exec(`INSERT INTO push_subs (uid, endpoint, p256dh, auth, added, auto) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(uid, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, added = excluded.added, auto = excluded.auto`,
      uid, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Number(sub.added) || Date.now(), sub.auto ? 1 : 0);
    this.sql.exec(`DELETE FROM push_subs WHERE uid = ? AND endpoint NOT IN
      (SELECT endpoint FROM push_subs WHERE uid = ? ORDER BY added DESC, endpoint LIMIT 5)`, uid, uid);
    this.sql.exec("INSERT OR IGNORE INTO push_ids (uid, seeded) VALUES (?, 0)", uid);
  }

  /** Removes a subscription. An id with none left keeps nothing: a later subscription starts from a first look. */
  unsubscribe(uid, endpoint) {
    this.sql.exec("DELETE FROM push_subs WHERE uid = ? AND endpoint = ?", uid, endpoint);
    if (this.has(uid)) return;
    this.sql.exec("DELETE FROM push_ids WHERE uid = ?", uid);
    this.sql.exec("DELETE FROM push_seen WHERE uid = ?", uid);
    this.sql.exec("DELETE FROM push_asks WHERE uid = ?", uid);
  }

  subsFor(uid) {
    return this.rows("SELECT endpoint, p256dh, auth, added, auto FROM push_subs WHERE uid = ? ORDER BY added, endpoint", uid).map(toSub);
  }

  /**
   * The ids to check in this minute, each with its subscriptions and what was
   * seen. With more than SLICE ids, the ids take turns: id number i is in the
   * run of each minute where i % slices equals minute % slices.
   */
  batch(minute) {
    const uids = this.rows("SELECT DISTINCT uid FROM push_subs ORDER BY uid").map((r) => r.uid);
    const slices = Math.ceil(uids.length / SLICE) || 1;
    return {
      imported: this.rows("SELECT v FROM meta WHERE k = 'push_import'")[0]?.v === "done",
      total: uids.length,
      batch: uids.filter((_, i) => i % slices === minute % slices).map((uid) => ({
        uid,
        subs: this.subsFor(uid),
        seeded: !!this.rows("SELECT seeded FROM push_ids WHERE uid = ?", uid)[0]?.seeded,
        seen: Object.fromEntries(this.rows("SELECT report, sig, keys, at FROM push_seen WHERE uid = ?", uid)
          .map((r) => [r.report, { sig: r.sig, keys: JSON.parse(r.keys), at: r.at }])),
        // When the server last asked this id's device to send an update request, for each report (ms).
        asked: Object.fromEntries(this.rows("SELECT report, at FROM push_asks WHERE uid = ?", uid).map((r) => [r.report, r.at])),
      })),
    };
  }

  /**
   * Saves a run. `updates` is [{ uid, seen: { report: { sig, keys, at } } }] with only the reports that changed
   * (the id is then past its first look). `gone` is [[uid, endpoint]] for subscriptions a push service dropped.
   * `asks` is [{ uid, report, at, exp }]: the server asked a device to send an update request, with a ticket good until `exp`.
   */
  save(updates, gone = [], asks = []) {
    for (const u of updates) {
      if (!this.has(u.uid)) continue;   // unsubscribed while the run was out
      this.sql.exec("INSERT INTO push_ids (uid, seeded) VALUES (?, 1) ON CONFLICT(uid) DO UPDATE SET seeded = 1", u.uid);
      for (const [report, s] of Object.entries(u.seen || {})) {
        this.sql.exec(`INSERT INTO push_seen (uid, report, sig, keys, at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(uid, report) DO UPDATE SET sig = excluded.sig, keys = excluded.keys, at = excluded.at`,
          u.uid, String(report), s.sig, JSON.stringify(s.keys || []), Number(s.at) || 0);
      }
    }
    for (const a of asks) {
      if (!this.has(a.uid)) continue;
      this.sql.exec(`INSERT INTO push_asks (uid, report, at, exp, used) VALUES (?, ?, ?, ?, 0)
        ON CONFLICT(uid, report) DO UPDATE SET at = excluded.at, exp = excluded.exp, used = 0`, a.uid, String(a.report), a.at, a.exp);
    }
    for (const [uid, endpoint] of gone) this.unsubscribe(uid, endpoint);
  }

  /** Takes the ticket of an ask: true one time for each ask, false after that and for a ticket the server did not give. */
  redeem(uid, report, exp) {
    return this.rows("UPDATE push_asks SET used = 1 WHERE uid = ? AND report = ? AND exp = ? AND used = 0 RETURNING 1 AS x", uid, String(report), exp).length > 0;
  }

  /** Gives a ticket back when the update request did not reach the city. */
  release(uid, report, exp) {
    this.sql.exec("UPDATE push_asks SET used = 0 WHERE uid = ? AND report = ? AND exp = ?", uid, String(report), exp);
  }

  /** One time: takes the two KV values of the old store. True when it did. */
  importOnce(subs, state) {
    if (this.rows("SELECT v FROM meta WHERE k = 'push_import'")[0]?.v === "done") return false;
    for (const [uid, list] of Object.entries(subs || {})) {
      for (const s of list || []) if (s?.endpoint && s.keys?.p256dh && s.keys?.auth) this.subscribe(uid, s);
    }
    for (const [uid, st] of Object.entries(state || {})) if (st?.seeded && this.has(uid)) this.save([{ uid, seen: st.seen || {} }]);
    this.sql.exec("INSERT INTO meta (k, v) VALUES ('push_import', 'done') ON CONFLICT(k) DO UPDATE SET v = 'done'");
    return true;
  }

  stats() {
    const n = (q) => Number(this.rows(q)[0]?.n || 0);
    return { ids: n("SELECT COUNT(DISTINCT uid) AS n FROM push_subs"), endpoints: n("SELECT COUNT(*) AS n FROM push_subs"), reports: n("SELECT COUNT(*) AS n FROM push_seen") };
  }
}
