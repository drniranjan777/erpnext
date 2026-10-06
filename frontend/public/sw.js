/*
 * Service worker for the shop-floor kiosk. It keeps the app's static files and the kiosk page
 * so a tablet can reopen the kiosk on a flaky connection. API calls are never cached: the
 * kiosk keeps its own queue of job-card events and the last board it saw.
 */
const CACHE = "ngerp-kiosk-v1";
const KIOSK = "/manufacturing/kiosk";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(KIOSK)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ngerp-kiosk-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Build output is content-hashed: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // The kiosk page: network first, the last copy when offline.
  if (req.mode === "navigate" && url.pathname === KIOSK) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(KIOSK, copy));
          }
          return res;
        })
        .catch(() => caches.match(KIOSK).then((hit) => hit || Response.error())),
    );
  }
});
