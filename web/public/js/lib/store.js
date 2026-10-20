// Persistence: small JSON values in localStorage, blobs and large values in
// IndexedDB. Both are per-origin and per-app (Safari keeps a home-screen app's
// storage apart from the browser's).

export const local = {
  get(k, fallback = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota or private mode */ }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
};

let dbp;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open("kc311", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction("kv", mode);
    const req = fn(t.objectStore("kv"));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const idb = {
  get: (k) => tx("readonly", (s) => s.get(k)).catch(() => undefined),
  set: (k, v) => tx("readwrite", (s) => s.put(v, k)).catch(() => undefined),
  del: (k) => tx("readwrite", (s) => s.delete(k)).catch(() => undefined),
};

/** Asks the browser not to evict this app's storage (granted to installed apps). */
export async function persist() {
  try { return (await navigator.storage?.persist?.()) || false; } catch { return false; }
}
