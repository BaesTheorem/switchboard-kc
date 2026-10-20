// Small helpers shared by the Worker modules.

export const enc = new TextEncoder();

export function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const b64urlText = (s) => b64url(enc.encode(s));

export function fromB64url(s) {
  const pad = "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad), (c) => c.charCodeAt(0));
}

export const randomHex = (n) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

/** Constant-time string compare (both sides are hashed first, so length leaks nothing). */
export async function sameSecret(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export const today = () => new Date().toISOString().slice(0, 10);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** Reads a JSON request body, with a size cap. */
export async function body(req, max = 64 * 1024) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) throw new HttpError(413, "too_large", "The request is too large.");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "too_large", "The request is too large.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "bad_json", "The request is not valid JSON.");
  }
}

/** The 16-hex-character id the city files "my reports" under. */
export function deviceId(v) {
  const id = String(v || "").trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(400, "bad_device", "The reports id must be 16 characters, 0 to 9 and a to f.");
  return id;
}
