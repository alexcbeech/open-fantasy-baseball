/* Open Fantasy Baseball service worker: Web Push receipt and notification focus. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
    badge: "/brand/ofb-tile.svg",
    icon: "/brand/ofb-tile.svg",
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
