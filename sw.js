const VERSION_URL = "./version";

async function getCacheName() {
  try {
    const res = await fetch(VERSION_URL, {
      cache: "no-store"
    });

    const version = await res.text();

    return `stashkeep-${version.trim()}`;
  } catch {
    return "stashkeep-fallback";
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const CACHE_NAME = await getCacheName();

      const cache = await caches.open(CACHE_NAME);

      const assets = [
        "./",
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
      ];

      for (const asset of assets) {
        try {
          const response = await fetch(asset);

          if (response.ok) {
            await cache.put(asset, response);
          }
        } catch (e) {
          console.warn("Cache failed:", asset);
        }
      }

      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const CURRENT_CACHE = await getCacheName();

      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames.map((name) => {
          if (
            name.startsWith("stashkeep-") &&
            name !== CURRENT_CACHE
          ) {
            return caches.delete(name);
          }
        })
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);

      if (cached) {
        return cached;
      }

      try {
        const response = await fetch(event.request);

        return response;
      } catch {
        return caches.match("./index.html");
      }
    })()
  );
});
