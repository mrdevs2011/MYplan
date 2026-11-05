// MYplan service worker: offline shell + standards-based Web Push.
const CACHE_NAME = "myplan-v11-reminders-pwa";
const PRECACHE = ["/", "/manifest.json", "/pwa-192.png", "/pwa-512.png", "/apple-touch-icon.png"];

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
    const title = typeof payload.title === "string" ? payload.title : "MYplan";
    const openClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visibleClient = openClients.find((client) => client.visibilityState === "visible");
    if (visibleClient) {
      visibleClient.postMessage({ type: "MYPLAN_PUSH", payload });
    }
    // Task reminders are urgent: one slot per task (later stages replace earlier ones but still alert),
    // they stay on screen until dealt with and vibrate.
    const isTaskReminder = payload.kind === "task-reminder";
    const options = {
      body: typeof payload.body === "string" ? payload.body : "Senga yangi eslatma bor.",
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

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (response?.status === 200) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    if (response?.status === 200 && (url.pathname.startsWith("/_next/static/") || url.pathname.match(/\.(png|jpg|jpeg|svg|ico|css|js|woff2)$/))) {
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
    }
    return response;
  }).catch(() => caches.match(event.request)));
});
