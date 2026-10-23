// Who may use the city proxy.
//
// Modes (KV "cfg:mode", else the MODE var):
// - open: anyone can call. This is the default. Turnstile guards filing when
//   it is configured, and each IP address gets SUBMIT_DAILY reports a day.
// - off:  the kill switch. City calls answer 503; the app still loads.
//
// The daily report counts live in the Ledger Durable Object (ledger.js), not
// KV: a report against the daily cap is one statement that two requests
// cannot both win.

import { HttpError, sameSecret, today } from "./util.js";

const MODES = ["open", "off"];

export async function getMode(env) {
  const m = await env.KV.get("cfg:mode", { cacheTtl: 60 });
  return MODES.includes(m) ? m : MODES.includes(env.MODE) ? env.MODE : "open";
}

export async function setMode(env, mode) {
  if (!MODES.includes(mode)) throw new HttpError(400, "bad_mode", `Mode must be one of ${MODES.join(", ")}.`);
  await env.KV.put("cfg:mode", mode);
}

export async function isAdmin(req, env) {
  return sameSecret(req.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "");
}

// ---------- the ledger ----------

/** The one Ledger Durable Object (ledger.js) that holds the daily report counts. */
const ledger = (env) => env.LEDGER.get(env.LEDGER.idFromName("ledger"));

/** Throws unless this request may call the city. Returns who to count it against. */
export async function gate(req, env) {
  const mode = await getMode(env);
  if (mode === "off") throw new HttpError(503, "paused", "This server is paused by its owner.");
  if (await isAdmin(req, env)) return { who: "owner", mode, admin: true };
  return { who: `ip:${req.headers.get("cf-connecting-ip") || "unknown"}`, mode };
}

// ---------- limits ----------

/** A burst limit from a Workers rate-limit binding, when the binding exists. */
export async function burst(env, binding, key) {
  if (!env[binding]?.limit) return;
  const { success } = await env[binding].limit({ key });
  if (!success) throw new HttpError(429, "slow_down", "Too many requests. Wait a minute and try again.");
}

/**
 * Takes one of today's report slots for this person, or throws when none is
 * left. Call refund() if the report then does not reach the city.
 */
export async function reserve(env, kind, who, max) {
  const k = `${kind}:${who}:${today()}`;
  if (!(await ledger(env).reserve(k, max, Date.now() + 3 * 86400e3))) throw new HttpError(429, "daily_limit", `This server allows ${max} reports a day per person. Try again tomorrow.`);
  return k;
}

export async function refund(env, k) {
  await ledger(env).refund(k);
}

/** Drops day counts older than three days (the cron calls it). */
export async function sweepCounts(env) {
  await ledger(env).sweep(Date.now());
}

/** Cloudflare Turnstile, required on filing when a secret is set. */
export async function turnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", String(token || ""));
  if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const o = await r.json().catch(() => ({}));
  if (!o.success) throw new HttpError(403, "turnstile", "The robot check did not pass. Try again.");
}
