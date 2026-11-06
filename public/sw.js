// MYplan service worker: offline shell + standards-based Web Push.
const CACHE_NAME = "myplan-v13-offline-first";
const PRECACHE = ["/", "/login", "/manifest.json", "/pwa-192.png", "/pwa-512.png", "/apple-touch-icon.png", "/myplan-logo-192.png"];

self.addEventListener("install", (event) => {
  // Best-effort precache so the shell opens offline after the first visit; never block installation on it.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url)))).catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "" }; }
    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title : "MYplan";
    const openClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visibleClient = openClients.find((client) => client.visibilityState === "visible");
    if (visibleClient) {
      visibleClient.postMessage({ type: "MYPLAN_PUSH", payload });
    }
    // The person is looking at the app: the in-app card is enough, a second system alert is only noise.
    if (openClients.some((client) => client.focused)) return;
    // Task reminders are urgent: one slot per task (later stages replace earlier ones but still alert),
    // they stay on screen until dealt with and vibrate.
    const isTaskReminder = payload.kind === "task-reminder";
    const options = {
      body: typeof payload.body === "string" && payload.body.trim() ? payload.body : "Senga yangi eslatma bor.",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      tag: isTaskReminder && typeof payload.activityId === "string"
        ? `myplan-task-${payload.activityId}`
        : typeof payload.id === "string" ? `myplan-${payload.id}` : "myplan-notification",
      renotify: isTaskReminder,
      requireInteraction: isTaskReminder,
      vibrate: isTaskReminder ? [200, 100, 200, 100, 200] : [120],
      timestamp: Date.now(),
      data: {
        url: typeof payload.url === "string" && payload.url.startsWith("/") && !payload.url.startsWith("//") && !payload.url.includes("\\") ? payload.url : "/",
        notificationId: typeof payload.id === "string" ? payload.id : null,
      },
    };
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedTarget = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil((async () => {
    const notificationId = event.notification.data?.notificationId;
    if (typeof notificationId === "string") requestedTarget.searchParams.set("notification_read", notificationId);
    const target = requestedTarget.origin === self.location.origin ? requestedTarget.href : new URL("/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

// Offline strategy
//  - Page loads: network first, but never wait more than a few seconds: on a weak or missing connection the saved
//    copy opens at once, so the app starts offline.
//  - /_next/static files have content hashes in their names, so a saved file is always the right one: cache first.
//  - Everything else from this site: network first with a saved fallback.
const NAVIGATION_TIMEOUT_MS = 3500;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function remember(request, response) {
  if (!response || response.status !== 200) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch { /* storage full: the app still works online */ }
}

// The page tells us which files it loaded, so a first visit (before this worker controlled the page) is saved too.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "MYPLAN_CACHE_URLS" || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const raw of event.data.urls.slice(0, 200)) {
      try {
        const url = new URL(raw, self.location.origin);
        if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) continue;
        if (await cache.match(url.href)) continue;
        const response = await fetch(url.href);
        if (response.status === 200) await cache.put(url.href, response);
      } catch { /* best effort */ }
    }
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await withTimeout(fetch(event.request), NAVIGATION_TIMEOUT_MS);
        void remember(event.request, response.clone());
        return response;
      } catch {
        return (await caches.match(event.request, { ignoreSearch: true })) || (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      void remember(event.request, response.clone());
      return response;
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (url.pathname.match(/\.(png|jpg|jpeg|svg|ico|css|js|woff2|json)$/)) void remember(event.request, response.clone());
      return response;
    } catch {
      return (await caches.match(event.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
