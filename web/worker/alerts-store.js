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
// Nothing here holds report text, addresses, or contact data.

/** Ids for each run. Each id costs one city call or more, and a run has 50 calls out on the free plan. */
export const SLICE = 15;

const toSub = (r) => ({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth }, added: r.added });

export class AlertStore {
  /** `sql` is a Durable Object's `ctx.storage.sql` (or the same interface over another SQLite, in the tests). */
  constructor(sql) {
    this.sql = sql;
    sql.exec("CREATE TABLE IF NOT EXISTS push_subs (uid TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, added INTEGER NOT NULL, PRIMARY KEY (uid, endpoint))");
    sql.exec("CREATE TABLE IF NOT EXISTS push_ids (uid TEXT PRIMARY KEY, seeded INTEGER NOT NULL DEFAULT 0)");
    sql.exec("CREATE TABLE IF NOT EXISTS push_seen (uid TEXT NOT NULL, report TEXT NOT NULL, sig TEXT NOT NULL, keys TEXT NOT NULL, PRIMARY KEY (uid, report))");
    sql.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  }

  rows(query, ...args) {
    return this.sql.exec(query, ...args).toArray();
  }

  has(uid) {
    return this.rows("SELECT 1 AS x FROM push_subs WHERE uid = ? LIMIT 1", uid).length > 0;
  }

  /** Adds a subscription to an id and keeps the newest five. `prior` is the id this browser had before a restore. */
  subscribe(uid, sub, prior = "") {
    if (prior && prior !== uid) this.unsubscribe(prior, sub.endpoint);
    this.sql.exec(`INSERT INTO push_subs (uid, endpoint, p256dh, auth, added) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(uid, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, added = excluded.added`,
      uid, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Number(sub.added) || Date.now());
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
  }

  subsFor(uid) {
    return this.rows("SELECT endpoint, p256dh, auth, added FROM push_subs WHERE uid = ? ORDER BY added, endpoint", uid).map(toSub);
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
        seen: Object.fromEntries(this.rows("SELECT report, sig, keys FROM push_seen WHERE uid = ?", uid)
          .map((r) => [r.report, { sig: r.sig, keys: JSON.parse(r.keys) }])),
      })),
    };
  }

  /**
   * Saves a run. `updates` is [{ uid, seen: { report: { sig, keys } } }] with only the reports that changed
   * (the id is then past its first look). `gone` is [[uid, endpoint]] for subscriptions a push service dropped.
   */
  save(updates, gone = []) {
    for (const u of updates) {
      if (!this.has(u.uid)) continue;   // unsubscribed while the run was out
      this.sql.exec("INSERT INTO push_ids (uid, seeded) VALUES (?, 1) ON CONFLICT(uid) DO UPDATE SET seeded = 1", u.uid);
      for (const [report, s] of Object.entries(u.seen || {})) {
        this.sql.exec(`INSERT INTO push_seen (uid, report, sig, keys) VALUES (?, ?, ?, ?)
          ON CONFLICT(uid, report) DO UPDATE SET sig = excluded.sig, keys = excluded.keys`, u.uid, String(report), s.sig, JSON.stringify(s.keys || []));
      }
    }
    for (const [uid, endpoint] of gone) this.unsubscribe(uid, endpoint);
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
