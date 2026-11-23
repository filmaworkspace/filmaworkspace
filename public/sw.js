// ─── Service worker de Filma (versión móvil instalable) ──────────────────────
// - Páginas: primero la red; sin conexión, la última copia o la página offline.
// - Recursos de Next (/_next/static, inmutables) e iconos: primero la caché.
// - Nada de Firebase ni de las APIs: siempre a la red (datos al día y privados).
const VERSION = "filma-v2";
const SHELL = ["/offline.html", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/logodark.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    // Solo se guardan copias de la versión móvil (el resto no se usa sin conexión).
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname.startsWith("/m")) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/m")) || caches.match("/offline.html")),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(svg|png|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
  }
});
