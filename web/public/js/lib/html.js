// HTML from template literals. Every interpolated value is escaped unless it
// is a template itself (html`...`) or wrapped in raw(). The city's data
// (descriptions, staff notes, addresses) is untrusted text, so views build
// all markup with html`` and never with string concatenation.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"'`]/g, (c) => ESC[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

/** Trusted markup. Use only for strings this app wrote. */
export const raw = (s) => new Safe(String(s));

function part(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}

/** A URL safe for href/src: http(s), tel, sms, mailto, or a same-origin path. Anything else becomes "#". */
export function safeUrl(u) {
  const s = String(u ?? "").trim();
  if (/^(https?:|tel:|sms:|mailto:|geo:|maps:)/i.test(s) || s.startsWith("/") || s.startsWith("#")) return s;
  return "#";
}

export const icon = (name, cls = "") => html`<i class="${cls}" aria-hidden="true">${name}</i>`;

export function render(el, tpl) {
  el.innerHTML = String(tpl);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Delegated event listener. Returns a function that removes it. */
export function on(root, type, selector, fn) {
  const h = (e) => {
    const t = e.target.closest?.(selector);
    if (t && root.contains(t)) fn(e, t);
  };
  root.addEventListener(type, h);
  return () => root.removeEventListener(type, h);
}

/** Collects cleanup functions for a view. */
export function bag() {
  const fns = [];
  const add = (...f) => { fns.push(...f.filter(Boolean)); return add; };
  add.run = () => { while (fns.length) { try { fns.pop()(); } catch { /* ignore */ } } };
  return add;
}
