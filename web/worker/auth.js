// Who may use the city proxy.
//
// Modes (KV "cfg:mode", else the MODE var):
// - invite: every city call needs a session, and a session needs an invite
//   code. This is the default.
// - open:   anyone can call; Turnstile guards filing when it is configured.
// - off:    the kill switch. City calls answer 503; the app still loads.
//
// A session is a signed token "v1.<invite hash>.<issued>.<mac>". It names the
// invite it came from, so revoking an invite ends its sessions. Invite codes
// are stored only as SHA-256 hashes.

import { HttpError, hmac, randomHex, sameSecret, sha256Hex, today } from "./util.js";

const MODES = ["invite", "open", "off"];
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export async function getMode(env) {
  const m = await env.KV.get("cfg:mode", { cacheTtl: 60 });
  return MODES.includes(m) ? m : MODES.includes(env.MODE) ? env.MODE : "invite";
}

export async function setMode(env, mode) {
  if (!MODES.includes(mode)) throw new HttpError(400, "bad_mode", `Mode must be one of ${MODES.join(", ")}.`);
  await env.KV.put("cfg:mode", mode);
}

async function sessionSecret(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  let s = await env.KV.get("cfg:session_secret", { cacheTtl: 3600 });
  if (!s) {
    s = randomHex(32);
    await env.KV.put("cfg:session_secret", s);
  }
  return s;
}

export async function isAdmin(req, env) {
  return sameSecret(req.headers.get("x-admin-token") || "", env.ADMIN_TOKEN || "");
}

/** The session behind a request, or null. */
export async function session(req, env) {
  const m = /^Bearer (v1\.([0-9a-f]{64})\.(\d+)\.([\w-]+))$/.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const [, , inv, iat, mac] = m;
  if (!(await sameSecret(mac, await hmac(await sessionSecret(env), `v1.${inv}.${iat}`)))) return null;
  const rec = await env.KV.get(`inv:${inv}`, { type: "json", cacheTtl: 60 });
  if (!rec || rec.revoked) return null;
  return { id: inv.slice(0, 16), invite: inv, label: rec.label };
}

/** Throws unless this request may call the city. Returns who to count it against. */
export async function gate(req, env) {
  const mode = await getMode(env);
  if (mode === "off") throw new HttpError(503, "paused", "This server is paused by its owner.");
  if (await isAdmin(req, env)) return { who: "owner", mode, admin: true };
  const s = await session(req, env);
  if (s) return { who: s.id, mode, session: s };
  if (mode === "invite") throw new HttpError(401, "invite_required", "This server is invite-only. Enter an invite code.");
  return { who: `ip:${req.headers.get("cf-connecting-ip") || "unknown"}`, mode };
}

// ---------- invites ----------

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return chars.match(/.{4}/g).join("-");
}

export const normalizeCode = (c) => String(c || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").match(/.{1,4}/g)?.join("-") || "";

export async function createInvite(env, label, max) {
  const code = newCode();
  const hash = await sha256Hex(code);
  const rec = { label: String(label || "").slice(0, 80) || "Invite", max: Math.max(1, Math.min(50, Number(max) || 3)),
                uses: 0, created: Date.now(), revoked: false, hint: code.slice(-4) };
  await env.KV.put(`inv:${hash}`, JSON.stringify(rec));
  return { code, id: hash.slice(0, 16), ...rec };
}

export async function listInvites(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.KV.list({ prefix: "inv:", cursor });
    for (const k of page.keys) {
      const rec = await env.KV.get(k.name, "json");
      if (rec) out.push({ id: k.name.slice(4, 20), ...rec });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out.sort((a, b) => b.created - a.created);
}

export async function revokeInvite(env, id) {
  const page = await env.KV.list({ prefix: `inv:${String(id).slice(0, 16)}` });
  if (page.keys.length !== 1) throw new HttpError(404, "no_invite", "No such invite.");
  const name = page.keys[0].name;
  const rec = await env.KV.get(name, "json");
  await env.KV.put(name, JSON.stringify({ ...rec, revoked: true }));
}

/** Trades an invite code for a session token. Each redemption uses one of the invite's uses. */
export async function redeem(env, rawCode) {
  const code = normalizeCode(rawCode);
  const hash = await sha256Hex(code);
  const rec = await env.KV.get(`inv:${hash}`, "json");
  if (!rec || rec.revoked) throw new HttpError(403, "bad_invite", "That invite code does not work.");
  if (rec.uses >= rec.max) throw new HttpError(403, "invite_used", "That invite code has been used up. Ask for a new one.");
  await env.KV.put(`inv:${hash}`, JSON.stringify({ ...rec, uses: rec.uses + 1, last: Date.now() }));
  const iat = String(Math.floor(Date.now() / 1000));
  const mac = await hmac(await sessionSecret(env), `v1.${hash}.${iat}`);
  return { token: `v1.${hash}.${iat}.${mac}`, label: rec.label };
}

// ---------- limits ----------

/** A burst limit from a Workers rate-limit binding, when the binding exists. */
export async function burst(env, binding, key) {
  if (!env[binding]?.limit) return;
  const { success } = await env[binding].limit({ key });
  if (!success) throw new HttpError(429, "slow_down", "Too many requests. Wait a minute and try again.");
}

/** A per-day cap kept in KV. Counts only successful actions (call `count` after). */
export async function dailyLeft(env, kind, who, max) {
  const n = Number(await env.KV.get(`cnt:${kind}:${who}:${today()}`)) || 0;
  if (n >= max) throw new HttpError(429, "daily_limit", `This server allows ${max} reports a day per person. Try again tomorrow.`);
  return max - n;
}

export async function count(env, kind, who) {
  const k = `cnt:${kind}:${who}:${today()}`;
  const n = Number(await env.KV.get(k)) || 0;
  await env.KV.put(k, String(n + 1), { expirationTtl: 3 * 86400 });
}

/** Cloudflare Turnstile, required on filing in open mode when a secret is set. */
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
