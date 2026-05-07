const VERSION_URL = "./version"; 

self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch(VERSION_URL)
      .then(res => res.text())
      .then(version => {
        const CACHE_NAME = `stashkeep-${version.trim()}`;
        return caches.open(CACHE_NAME).then((cache) => {
          return cache.addAll([
            "index.html",
            "app.js",
            "style.css",
            "site.webmanifest",
            "lang/languages.json",
            "lang/en.json",
            "icons/favicon.ico",
            "icons/favicon-16x16.png",
            "icons/favicon-32x32.png",
            "icons/apple-touch-icon.png",
            "icons/android-chrome-192x192.png",
            "icons/android-chrome-512x512.png",
            "https://cdn.jsdelivr.net/npm/marked/marked.min.js",
          ]);
        });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    fetch(VERSION_URL)
      .then(res => res.text())
      .then(version => {
        const CURRENT_CACHE = `stashkeep-${version.trim()}`;
        return caches.keys().then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter((name) => name.startsWith("stashkeep-") && name !== CURRENT_CACHE)
              .map((name) => caches.delete(name))
          )
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const isCoreAsset = event.request.url.match(/\.(html|js|css|json)$/) || 
                      event.request.url.endsWith("/StashKeep/");

  if (isCoreAsset) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            fetch(VERSION_URL).then(res => res.text()).then(version => {
              caches.open(`stashkeep-${version.trim()}`).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request).then((networkResponse) => {
          return networkResponse;
        });
      })
    );
  }
});
