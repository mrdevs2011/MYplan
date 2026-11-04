// MyPlan High-Reliability Production Service Worker
const CACHE_NAME = "myplan-v2";
const STATIC_ASSETS = [
  "/",
  "/favicon.ico",
  "/icon.png",
  "/myplan-logo.png",
  "/manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Only process GET requests
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Bypass cross-origin requests, auth endpoints, or Supabase APIs
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request)
        .then((response) => {
          // Cache successful static assets dynamically
          if (
            response &&
            response.status === 200 &&
            (url.pathname.startsWith("/_next/static/") ||
              url.pathname.match(/\.(png|jpg|jpeg|svg|ico|css|js|woff2)$/))
          ) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Graceful fallback for navigation requests
          if (event.request.mode === "navigate") {
            return caches.match("/");
          }
          return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
        });
    })
  );
});
