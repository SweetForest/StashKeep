const VERSION_URL = "./version";
const FALLBACK_CACHE_NAME = "stashkeep-offline-fallback";

async function getCacheName() {
  try {
    const res = await fetch(VERSION_URL);
    if (!res.ok) throw new Error();
    const version = await res.text();
    return `stashkeep-${version.trim()}`;
  } catch (e) {
    const keys = await caches.keys();
    const latest = keys.find(name => name.startsWith("stashkeep-"));
    return latest || FALLBACK_CACHE_NAME;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    getCacheName().then((cacheName) => {
      return caches.open(cacheName).then((cache) => {
        return cache.addAll([
            "./index.html",
            "./app.js",
            "./style.css",
            "./site.webmanifest",
            "./lang/languages.json",
            "./lang/en.json",
            "./icons/favicon.ico",
            "./icons/favicon-16x16.png",
            "./icons/favicon-32x32.png",
            "./icons/apple-touch-icon.png",
            "./icons/android-chrome-192x192.png",
            "./icons/android-chrome-512x512.png",
            "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
          ]);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    getCacheName().then((currentCache) => {
      return caches.keys().then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith("stashkeep-") && name !== currentCache)
            .map((name) => caches.delete(name))
        )
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const isCoreAsset = event.request.url.match(/\.(html|js|css|json)$/) || 
                      event.request.url.includes("/StashKeep/");

  if (isCoreAsset) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            getCacheName().then(name => {
              caches.open(name).then(cache => cache.put(event.request, responseToCache));
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request);
      })
    );
  }
});
