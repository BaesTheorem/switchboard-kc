// City notices: the messages behind the bell in the city's app
// (notification_history, docs/API.md section 10). The city sends them to
// every phone: a holiday trash delay, for example. The list is the same for
// each device id, so the server reads it with an unused id and keeps the
// answer for ten minutes.
//
// The city writes a notice as HTML. This file turns it into plain text and a
// list of links, so no markup from the city reaches a page.

import { API_VERSION, civicJSON, getConfig } from "./civic.js";
import { HttpError, json, randomHex } from "./util.js";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "-", mdash: "-", hellip: "..." };

/** Named and numbered HTML entities as characters. An unknown name stays as it is. */
export function decode(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : "";
  });
}

/** An http(s) address as https text, or "" for each other kind of address. */
function webAddress(href) {
  try {
    const u = new URL(decode(href).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    u.protocol = "https:";
    return u.toString();
  } catch {
    return "";
  }
}

/**
 * One row of notification_history as { id, title, text, links: [{ text, url }], at }.
 * `text` has no markup: a paragraph or a line break is a new line, and each
 * other tag is removed. `at` is in ms.
 */
export function cleanNotice(row) {
  const links = [];
  let body = String(row?.description ?? "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, _q, a, b, c, inner) => {
      const url = webAddress(a ?? b ?? c ?? "");
      const text = decode(inner.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
      if (url && !links.some((l) => l.url === url)) links.push({ text, url });
      return inner;
    })
    .replace(/<\s*br\s*\/?>|<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  body = decode(body).replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    id: String(row?.id ?? ""),
    title: decode(String(row?.title ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim(),
    text: body.slice(0, 4000),
    links: links.slice(0, 6),
    at: (Number(row?.timestamp) || 0) * 1000,
  };
}

/** The notices of the past `days` days, newest first. Rows with no id or no title are left out. */
export function cleanNotices(rows, now = Date.now(), days = 30) {
  return (Array.isArray(rows) ? rows : []).map(cleanNotice)
    .filter((n) => n.id && n.title && n.at > now - days * 86400e3 && n.at <= now + 86400e3)
    .sort((a, b) => b.at - a.at).slice(0, 20);
}

let memo = { at: 0, notices: null };

/** GET /api/notices. One city call in ten minutes for each isolate. A city error gives the last good list when there is one. */
export async function notices(env) {
  if (memo.notices && Date.now() - memo.at < 600_000) return json({ ok: true, notices: memo.notices, read: memo.at }, 200, { "cache-control": "private, max-age=300" });
  const cfg = await getConfig(env);
  if (!cfg) throw new HttpError(503, "no_key", "The server has no city API key yet.");
  const uid = randomHex(8);
  try {
    const o = await civicJSON(env, uid, "notification_history", { city_id: cfg.city_id, device_id: uid, api_version: API_VERSION, timestamp: "0" });
    if (String(o.response_code) !== "0") throw new HttpError(502, "city_error", String(o.response_message || o.response_status || "The city did not send its notices."));
    memo = { at: Date.now(), notices: cleanNotices(o.response_data) };
  } catch (e) {
    if (!memo.notices) throw e;
  }
  return json({ ok: true, notices: memo.notices, read: memo.at }, 200, { "cache-control": "private, max-age=300" });
}
