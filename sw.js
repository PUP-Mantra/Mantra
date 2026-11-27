// Mantra app helper (service worker). It makes the site installable as an app.
// NEWEST FIRST: every page load asks GitHub for the latest files; the saved copy is only used when there is no internet,
// so an update you upload is never hidden behind an old copy. Logins, check-ins and the garden (Apps Script) are never touched.
const CACHE = "mantra-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;   // only this site's own files
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("./") : undefined))
        .then((hit) => hit || new Response("Mantra needs the internet. Please check your connection and try again.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })))
  );
});
