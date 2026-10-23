// The service worker: the app shell offline, and ticket alerts.
// - App files: cache first, refreshed in the background (bin/deploy changes
//   VERSION, which starts a new cache and drops the old one).
// - /api and map tiles: always the network; the app keeps its own saved
//   copies of city data.
// - push: shows the notification the server sent; a tap opens the report.

const VERSION = "20261023T1723";
const CACHE = `switchboard-${VERSION}`;
const SHELL = [
  "/", "/manifest.webmanifest", "/css/app.css",
  "/vendor/beercss/beer.min.css", "/vendor/beercss/material-symbols-outlined.woff2",
  "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/icons/favicon-64.png",
  "/js/app.js", "/js/api.js", "/js/catalog.js", "/js/draft.js", "/js/health.js", "/js/map.js", "/js/models.js",
  "/js/place.js", "/js/router.js", "/js/state.js", "/js/theme.js", "/js/ui.js",
  "/js/lib/arcgis.js", "/js/lib/exif.js", "/js/lib/format.js", "/js/lib/geo.js", "/js/lib/html.js",
  "/js/lib/image.js", "/js/lib/store.js", "/js/lib/zip.js",
  "/js/views/report.js", "/js/views/services.js", "/js/views/section.js", "/js/views/all.js", "/js/views/directory.js",
  "/js/views/form.js", "/js/views/picker.js", "/js/views/done.js", "/js/views/parts.js", "/js/views/alerts.js",
  "/js/views/reports.js", "/js/views/detail.js", "/js/views/updates.js", "/js/views/settings.js", "/js/views/invite.js",
  "/js/views/city.js", "/js/views/help.js", "/js/views/places.js", "/js/views/licenses.js", "/js/views/transit.js",
  "/js/views/streetcar.js", "/js/workers/gtfs.js", "/data/health-centers.json", "/vendor/icons.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // One missing file must not block the install.
    await Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("switchboard-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") {
    // The page itself: the network first, so a deploy shows at once; the saved shell offline.
    // The shell is kept under "/" (the host redirects /index.html to /, and a
    // browser refuses a redirected response for a page load).
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && !r.redirected) { const copy = r.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put("/", copy))); }
      return r;
    }).catch(async () => {
      const hit = await caches.match("/");
      return hit ? new Response(hit.body, { status: 200, headers: hit.headers }) : Response.error();
    }));
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || Response.error();
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data?.json() || {}; } catch { d = { title: "Switchboard KC", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Switchboard KC", {
    body: d.body || "A report changed.",
    tag: d.tag || "kc311",
    icon: "/icons/icon-192.png",
    badge: "/icons/favicon-64.png",
    data: { url: d.url || "/#/reports" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/#/reports";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === location.origin) {
        await c.focus();
        return c.navigate(url).catch(() => c.postMessage({ open: url }));
      }
    }
    return self.clients.openWindow(url);
  })());
});
