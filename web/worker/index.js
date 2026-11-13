// The web app's server: static files from public/, and under /api a scoped
// proxy to the city's 311 API. The proxy forwards only the dozen calls the
// app makes, each built here from checked fields, never a raw passthrough.
// auth.js decides who may call it (anyone, unless the owner pauses it).

import { isAskFor, makeTicket, readTicket, TICKET_LIFE } from "./asks.js";
import { burst, gate, getMode, isAdmin, ledger, refund, reserve, setMode, sweepCounts, turnstile } from "./auth.js";
import { accepts, API_VERSION, baseFields, civic, civicJSON, getConfig, KANSAS_CITY, markKey, MENU_REPORT, myReports, readKeyState, reportDetail, addNote } from "./civic.js";
import { relayApk, setKey, testCandidates } from "./keys.js";
import { notices } from "./notices.js";
import { calendarFeed, gtfs, hud, meetings } from "./open.js";
import { poll, subscribe, test as pushTest, unsubscribe, vapid } from "./push.js";
import { ratingBlock, ratingDetails, STARS } from "./rating.js";
import { body, deviceId, HttpError, json, randomHex, softPut } from "./util.js";

export { Ledger } from "./ledger.js";

const str = (v, max = 300) => String(v ?? "").slice(0, max);

// ---------- city reads ----------

// The catalog text, kept 10 minutes in this isolate, so the app's opens in that time read KV one time.
let catalogMemo = { key: "", text: "", at: 0 };

/** The report catalog (get_main), trimmed to the three tables the app reads and kept 6 hours. */
async function catalog(env) {
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  const key = `cache:catalog:${cfg.app_version}`;
  let text = catalogMemo.key === key && Date.now() - catalogMemo.at < 600_000 ? catalogMemo.text : await env.KV.get(key, { cacheTtl: 600 });
  if (!text) {
    const uid = randomHex(8);
    const o = await civicJSON(env, uid, "get_main", { ...baseFields(cfg, uid), timestamp: "0" });
    if (Number(o.response_status?.response_code) !== 1) throw new HttpError(502, "city_error", "The city's server did not send the report types.");
    const keep = { RAI_CATEGORY: [], RAI_SUBCATEGORY: [], MENU: [] };
    for (const t of o.response_data?.data || []) if (t.table_name in keep) keep[t.table_name] = t.records || [];
    keep.MENU = keep.MENU.filter((r) => r.menu_item_type === "HTML")
      .map((r) => ({ menu_item_name: r.menu_item_name, menu_item_url: r.menu_item_url, ios_url: r.ios_url }));
    text = JSON.stringify({ at: Date.now(), tables: keep });
    await softPut(env, key, text, { expirationTtl: 6 * 3600 });
  }
  catalogMemo = { key, text, at: Date.now() };
  return new Response(text, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

async function map(env, b) {
  const uid = deviceId(b.device);
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!(lat > 38.7 && lat < 39.6 && lng > -95 && lng < -94.1)) throw new HttpError(400, "bad_point", "That point is not in Kansas City.");
  const status = ["open", "closed", "all"].includes(b.status) ? b.status : "open";
  const types = (Array.isArray(b.types) ? b.types : []).map((t) => str(t, 120)).filter(Boolean).slice(0, 50);
  if (!types.length) throw new HttpError(400, "no_types", "Name at least one report type.");
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  const res = await civic(env, uid, "reported_issues_map", {
    ...baseFields(cfg, uid), menu_id: MENU_REPORT, lat: String(lat), lng: String(lng),
    FilterOptions: JSON.stringify({ status, issue_type: types.join(",") }),
  });
  // The city answers HTTP 500 for some mixes of types; the app then asks for each type alone.
  if (res.status !== 200) return json({ ok: false, error: "city_error", status: res.status }, 502);
  return new Response(res.text, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

async function duplicate(env, b) {
  const uid = deviceId(b.device);
  const p = b.payload || {};
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  const o = await civicJSON(env, uid, "check_duplicate_issue", {
    POST_JSON: JSON.stringify({
      city_id: cfg.city_id, api_version: API_VERSION, deviceuid: uid, device_id: uid,
      latitude: str(p.latitude, 30), longitude: str(p.longitude, 30), address: str(p.address), city: str(p.city, 80),
      state: str(p.state, 20), zip: str(p.zip, 20), type: str(p.type, 40), subtype: str(p.subtype, 200),
    }),
  });
  return json({ ok: true, level: String(o.response_data?.allow_duplicate ?? "0"), message: String(o.response_message || "") });
}

/** Files a REAL report with the city. The issue JSON is built by the app; this checks that it names this city and this id. */
async function submit(req, env, who, owner) {
  if (Number(req.headers.get("content-length") || 0) > 12 * 1024 * 1024) throw new HttpError(413, "too_large", "The photos are too large.");
  const form = await req.formData();
  const uid = deviceId(form.get("device"));
  const details = String(form.get("issue_details") || "");
  if (details.length > 64 * 1024) throw new HttpError(413, "too_large", "The report is too large.");
  let issue;
  try { issue = JSON.parse(details); } catch { throw new HttpError(400, "bad_report", "The report is not valid JSON."); }
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  if (issue.city_id !== cfg.city_id || String(issue.menu_id) !== MENU_REPORT || issue.deviceuid !== uid || issue.device_id !== uid) {
    throw new HttpError(400, "bad_report", "The report does not match this city or this reports id.");
  }
  const zip = form.get("file_zip");
  const files = [];
  if (zip && typeof zip !== "string" && zip.size > 0) {
    if (zip.size > 10 * 1024 * 1024) throw new HttpError(413, "too_large", "The photos are too large.");
    const head = new Uint8Array(await zip.slice(0, 4).arrayBuffer());
    if (head[0] !== 0x50 || head[1] !== 0x4b) throw new HttpError(400, "bad_zip", "The photos are not a zip file.");
    files.push({ name: "file_zip", blob: zip, filename: `${Date.now()}_images.zip` });
  }
  // An update request that a device sends when its app is closed has a ticket from this server (asks.js).
  // The ticket is for one report, and the request must be an update request that names it, with no photos.
  let ask = null;
  if (form.get("ticket")) {
    const report = str(form.get("report"), 20).replace(/\D/g, "");
    const caseNumber = str(form.get("case"), 40);
    const exp = await readTicket((await vapid(env)).privateKey, uid, report, caseNumber, form.get("ticket"));
    if (!exp || files.length || !isAskFor(issue, report, caseNumber)) throw new HttpError(403, "bad_ticket", "This update request is past its time. Open the app to send it.");
    ask = { report, exp };
  }
  // The owner (the owner token) skips the robot check, and a ticket takes its place; everyone else passes it.
  if (!owner && !ask) await turnstile(env, form.get("turnstile"), req.headers.get("cf-connecting-ip"));
  // Test runs send this header: every check above runs, and nothing goes to the city.
  if (req.headers.get("x-kc311-dry-run") === "1") return json({ ok: true, message: "Dry run: not sent to the city.", work_order: "DRYRUN", dry: true });
  // A ticket works one time.
  if (ask && !(await ledger(env).alertRedeem(uid, ask.report, ask.exp))) throw new HttpError(409, "ticket_used", "This update request went to the city already.");
  // One of today's slots is taken before the city call and given back if the report does not get through.
  let slot;
  let o;
  try {
    slot = await reserve(env, "submit", who, Number(env.SUBMIT_DAILY || 10));
    o = await civicJSON(env, uid, "report_an_issue", { issue_details: details }, files);
  } catch (e) {
    if (slot) await refund(env, slot);
    if (ask) await ledger(env).alertRelease(uid, ask.report, ask.exp);
    throw e;
  }
  const st = o.response_status || {};
  const ok = String(st.response_code) === "1";
  if (!ok) {
    await refund(env, slot);
    if (ask) await ledger(env).alertRelease(uid, ask.report, ask.exp);
  }
  return json({ ok, message: String(st.response_message || ""), work_order: String(st.work_order || "") }, ok ? 200 : 422);
}

/** Sends a REAL note to staff on one of this id's reports. */
async function note(req, env) {
  const b = await body(req);
  const uid = deviceId(b.device);
  const id = str(b.id, 20).replace(/\D/g, "");
  const text = String(b.text ?? "").trim();
  if (!id) throw new HttpError(400, "bad_id", "Name the report.");
  if (!text) throw new HttpError(400, "empty_note", "Write the note first.");
  if (text.length > 2000) throw new HttpError(413, "too_long", "Keep the note under 2,000 characters.");
  // Test runs send this header: the checks above run, and nothing goes to the city.
  if (req.headers.get("x-kc311-dry-run") === "1") return json({ ok: true, dry: true, issue: null });
  return json({ ok: true, issue: await addNote(env, uid, id, text) });
}

/**
 * Sends a REAL rating (1 to 5 stars) of one of this id's closed reports.
 * The city's call names a report by its number alone. This server reads the
 * id's own list first, and sends the rating only for a report that is in the
 * list, is closed, and has no rating.
 */
async function rate(req, env) {
  const b = await body(req);
  const uid = deviceId(b.device);
  const id = str(b.id, 20).replace(/\D/g, "");
  const rating = Number(b.rating);
  const text = String(b.text ?? "").trim();
  if (!id) throw new HttpError(400, "bad_id", "Name the report.");
  if (!STARS.includes(rating)) throw new HttpError(400, "bad_rating", "Select 1 to 5 stars.");
  if (text.length > 2000) throw new HttpError(413, "too_long", "Keep the comment under 2,000 characters.");
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  const row = (await myReports(env, uid)).find((r) => String(r.id) === id);
  const block = ratingBlock(row);
  if (block === "not_yours") throw new HttpError(404, "not_yours", "This report is not in your list.");
  if (block === "not_closed") throw new HttpError(409, "not_closed", "The city takes a rating only after it closes the report.");
  if (block === "rated") throw new HttpError(409, "rated", "This report has a rating already.");
  const details = ratingDetails(cfg.city_id, API_VERSION, uid, row, rating, text);
  // Test runs send this header: the checks above run, and nothing goes to the city.
  if (req.headers.get("x-kc311-dry-run") === "1") return json({ ok: true, dry: true, would_send: details });
  const o = await civicJSON(env, uid, "rai_report_rating", { rating_details: JSON.stringify(details) });
  const st = o.response_status || {};
  const message = String(st.response_message || o.response_message || "");
  if (String(st.response_code) !== "1") throw new HttpError(422, "rating_refused", message || "The city did not take the rating.");
  return json({ ok: true, message });
}

let lastProbe = 0;
async function health(env, url) {
  const cfg = await getConfig(env);
  if (cfg && url.searchParams.get("probe") === "1" && Date.now() - lastProbe > 10 * 60_000) {
    lastProbe = Date.now();
    await markKey(env, (await accepts(cfg)) ? "ok" : "rejected");
  }
  const state = await readKeyState(env);
  return json({
    ok: !!cfg && state.state !== "rejected",
    state: cfg ? state.state : "no_key",
    since: state.at || null,
    key: cfg ? { app_version: cfg.app_version, source: cfg.source || "", updated: cfg.updated || null, host: new URL(cfg.base_url).host } : null,
  });
}

async function config(req, env) {
  const [mode, admin, v, cfg] = await Promise.all([getMode(env), isAdmin(req, env), vapid(env), getConfig(env)]);
  return json({
    app: env.APP_NAME || "Switchboard KC",
    mode,
    admin,
    vapid: v.publicKey,
    turnstile: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET ? env.TURNSTILE_SITE_KEY : null,
    submitDaily: Number(env.SUBMIT_DAILY || 10),
    city: cfg?.city_id || KANSAS_CITY,
  });
}

// ---------- owner ----------

async function admin(req, env, url, ctx) {
  if (!env.ADMIN_TOKEN || !(await isAdmin(req, env))) throw new HttpError(403, "not_owner", "Owner token required.");
  const p = url.pathname.slice("/api/admin/".length);
  if (req.method === "POST" && p === "mode") { await setMode(env, (await body(req)).mode); return json({ ok: true, mode: await getMode(env) }); }
  if (req.method === "POST" && p === "key") return setKey(env, await body(req));
  if (req.method === "POST" && p === "run") return json({ ok: true, results: await poll(env) });
  // A ticket for one report of one id, as the cron makes it (asks.js). For tests of the ticket path with a dry run.
  if (req.method === "POST" && p === "ticket") {
    const b = await body(req);
    const uid = deviceId(b.device);
    const report = str(b.report, 20).replace(/\D/g, "");
    const exp = Date.now() + TICKET_LIFE;
    return json({ ok: true, ticket: await makeTicket((await vapid(env)).privateKey, uid, report, str(b.case, 40), exp), exp });
  }
  if (req.method === "GET" && p === "status") {
    const alerts = await ledger(env).alertStats();
    return json({ ok: true, mode: await getMode(env), alertIds: alerts.ids, alerts, key: await readKeyState(env), config: { ...((await getConfig(env)) || {}), key: undefined } });
  }
  throw new HttpError(404, "not_found", "No such owner action.");
}

// ---------- router ----------

async function route(req, env, ctx, url) {
  const p = url.pathname;
  const origin = req.headers.get("origin");
  // Browsers on other sites must not drive this proxy. Scripts send no Origin.
  if (req.method !== "GET" && origin && origin !== url.origin) throw new HttpError(403, "origin", "Cross-site requests are not allowed.");

  if (p === "/api/config" && req.method === "GET") return config(req, env);
  if (p.startsWith("/api/admin/")) return admin(req, env, url, ctx);
  if (p === "/api/health" && req.method === "GET") return health(env, url);

  const g = await gate(req, env);
  await burst(env, "READS", g.who);

  if (p === "/api/catalog" && req.method === "GET") return catalog(env);
  if (p === "/api/notices" && req.method === "GET") return notices(env);
  if (p === "/api/open/hud" && req.method === "GET") return hud(url);
  if (p === "/api/open/gtfs" && req.method === "GET") return gtfs();
  if (p === "/api/meetings" && req.method === "GET") return meetings(env, "meetings");
  if (p === "/api/bodies" && req.method === "GET") return meetings(env, "bodies");
  if (req.method === "GET" && p === "/api/key/apk") return relayApk(env, g.admin);
  if (req.method !== "POST") throw new HttpError(404, "not_found", "No such endpoint.");

  if (p === "/api/submit") {
    await burst(env, "WRITES", g.who);
    return submit(req, env, g.who, !!g.admin);
  }
  if (p === "/api/note") {
    await burst(env, "WRITES", g.who);
    return note(req, env);
  }
  if (p === "/api/rate") {
    await burst(env, "WRITES", g.who);
    return rate(req, env);
  }
  const b = await body(req);
  switch (p) {
    case "/api/myissues": return json({ ok: true, my_issues: await myReports(env, deviceId(b.device)) });
    case "/api/detail": return json({ ok: true, issue: await reportDetail(env, deviceId(b.device), str(b.id, 20).replace(/\D/g, ""), b.scope === "public" ? "public" : "mine") });
    case "/api/map": return map(env, b);
    case "/api/duplicate": return duplicate(env, b);
    case "/api/key/candidates": await burst(env, "SLOW", `key:${g.who}`); return testCandidates(env, b);
    case "/api/push/subscribe": return subscribe(env, b);
    case "/api/push/unsubscribe": return unsubscribe(env, b);
    case "/api/push/test": await burst(env, "SLOW", `ptest:${g.who}`); return pushTest(env, b);
  }
  throw new HttpError(404, "not_found", "No such endpoint.");
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Pages on any other address (workers.dev) move to the app's own address.
    // The API and the calendar feeds stay on both, for apps and calendars set up before the move.
    const home = env.CANONICAL_HOST;
    if (home && url.hostname !== home && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/cal/")) {
      return Response.redirect(`https://${home}${url.pathname}${url.search}`, 301);
    }
    // Calendar apps read the meeting feeds with no token, as on Common Lot.
    if (url.pathname.startsWith("/cal/")) {
      try { return await calendarFeed(env, url.pathname); } catch (e) {
        if (e instanceof HttpError) return json({ ok: false, error: e.code, message: e.message }, e.status);
        throw e;
      }
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, ctx, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ ok: false, error: e.code, message: e.message }, e.status);
      console.error(e?.stack || e);
      return json({ ok: false, error: "server", message: "Something went wrong on the server." }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(poll(env, event.scheduledTime).then((r) => r.length && console.log(JSON.stringify(r))));
    // Once an hour, drop day counts older than three days.
    if (new Date(event.scheduledTime).getUTCMinutes() === 0) ctx.waitUntil(sweepCounts(env));
  },
};
