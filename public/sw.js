/* Open Fantasy Baseball service worker: offline navigation fallback and Web Push. */

const CACHE_PREFIX = "ofb-";
const CACHE_NAME = `${CACHE_PREFIX}offline-v1`;
const OFFLINE_URL = "/offline.html";
const OFFLINE_ASSETS = [OFFLINE_URL, "/offline.css", "/brand/ofb-tile.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") {
    return;
  }

  // Authenticated HTML can contain private league data, so navigation responses
  // are deliberately never cached. Show a static explanation when offline.
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Open Fantasy Baseball", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Open Fantasy Baseball";
  const options = {
    body: payload.body || "",
    tag: payload.tag || "ofb",
    data: { url: payload.url || "/" },
    badge: "/icons/icon-192.png",
    icon: "/icons/icon-192.png",
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data && event.notification.data.url) || "/";

  // Only navigate within our own origin: push payloads are server-controlled
  // today, but a foreign URL should never be able to steer an open tab.
  let targetUrl = "/";
  try {
    const resolved = new URL(rawUrl, self.location.origin);
    if (resolved.origin === self.location.origin) {
      targetUrl = resolved.href;
    }
  } catch {
    targetUrl = "/";
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          return Promise.resolve(client.navigate(targetUrl))
            .catch(() => undefined)
            .then(() => client.focus());
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
