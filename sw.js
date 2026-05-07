// ============================================================
//  StashKeep Service Worker
// ============================================================
//
//  To update: bump CACHE_VERSION (e.g. "v1" -> "v2") on each deploy.
//  The old cache will be purged automatically on activation.
//
// ============================================================

const CACHE_VERSION = "v1";
const CACHE_NAME = `stashkeep-${CACHE_VERSION}`;

// All static assets to precache for offline support
const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/app.js",
  "/style.css",
  "/site.webmanifest",
  "/lang/languages.json",
  "/lang/en.json",
  "/icons/favicon.ico",
  "/icons/favicon-16x16.png",
  "/icons/favicon-32x32.png",
  "/icons/apple-touch-icon.png",
  "/icons/android-chrome-192x192.png",
  "/icons/android-chrome-512x512.png",
  // CDN library — cached so markdown renders offline
  "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
];

// ============================================================
//  INSTALL — precache all assets
// ============================================================
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // skipWaiting: activate immediately without waiting for tabs to close
      .then(() => self.skipWaiting())
  );
});

// ============================================================
//  ACTIVATE — purge stale caches
// ============================================================
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith("stashkeep-") && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      // clients.claim: take control of all open tabs immediately
      .then(() => self.clients.claim())
  );
});

// ============================================================
//  FETCH — Cache First strategy
//
//  1. Cache hit  → return cached response immediately
//  2. Cache miss → fetch from network, store result in cache
//  3. Offline + cache miss → fall back to index.html
// ============================================================
self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback — app still works since data lives in localStorage
          return caches.match("/index.html");
        });
    })
  );
});
