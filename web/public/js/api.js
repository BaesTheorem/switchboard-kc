// Calls to this app's own server (/api). The server signs and forwards each
// call to the city; see worker/index.js for the list.

import { local } from "./lib/store.js";

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
  get offline() { return this.code === "offline"; }
}

const listeners = new Set();
/** Called with every ApiError (the app starts a key repair when the key is the problem). */
export const onApiError = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function authHeaders() {
  const h = {};
  const owner = local.get("ownerToken");
  if (owner) h["x-admin-token"] = owner;
  // Set by the test runs: the server checks a report and then does not send it to the city.
  if (local.get("dryRun")) h["x-kc311-dry-run"] = "1";
  return h;
}

/**
 * `api("myissues", { body: {...} })` POSTs JSON; `api("catalog")` GETs;
 * `api("submit", { form })` POSTs multipart. Resolves to the parsed JSON.
 */
export async function api(path, { body, form, method, signal, raw = false } = {}) {
  const headers = authHeaders();
  if (body !== undefined) headers["content-type"] = "application/json";
  let r;
  try {
    r = await fetch(`/api/${path}`, {
      method: method || (body !== undefined || form ? "POST" : "GET"),
      headers, signal, body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    const err = new ApiError("offline", "No connection to the server.");
    listeners.forEach((f) => f(err));
    throw err;
  }
  if (raw && r.ok) return r;
  const o = await r.json().catch(() => null);
  if (!r.ok || o?.ok === false) {
    const err = new ApiError(o?.error || `http_${r.status}`, o?.message || `The server returned an error (HTTP ${r.status}).`, r.status);
    listeners.forEach((f) => f(err));
    throw err;
  }
  return o;
}
