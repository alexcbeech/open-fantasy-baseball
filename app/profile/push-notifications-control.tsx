"use client";

import { useCallback, useEffect, useState } from "react";

type Banner = { kind: "idle" | "success" | "error"; message: string };

type ServerStatus = {
  configured: boolean;
  publicKey: string | null;
  activeCount: number;
};

const SERVICE_WORKER_URL = "/sw.js";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }

  return output;
}

function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function PushNotificationsControl() {
  const [supported, setSupported] = useState(true);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: "idle", message: "" });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/profile/push");

      if (response.ok) {
        const data = (await response.json()) as ServerStatus;
        setStatus(data);
      }

      if (isPushSupported()) {
        const registration = await navigator.serviceWorker.getRegistration();
        const existing = registration ? await registration.pushManager.getSubscription() : null;
        setSubscribed(Boolean(existing));
      }
    } catch {
      // A refresh failure (offline, server restart) keeps the current state;
      // it must not surface as an unhandled rejection from the mount effect.
    }
  }, []);

  useEffect(() => {
    if (!isPushSupported()) {
      setSupported(false);
      return;
    }

    setPermission(Notification.permission);
    navigator.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {
      setBanner({ kind: "error", message: "The notification service worker could not be registered." });
    });
    void refresh();
  }, [refresh]);

  async function enable() {
    if (!status?.publicKey) {
      setBanner({ kind: "error", message: "Web Push is not configured on this server." });
      return;
    }

    setBusy(true);
    setBanner({ kind: "idle", message: "Enabling push notifications..." });

    try {
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result !== "granted") {
        setBanner({ kind: "error", message: "Notification permission was not granted." });
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(status.publicKey),
      });

      const response = await fetch("/api/v1/profile/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setBanner({ kind: "error", message: data.error ?? "Push subscription could not be saved." });
        return;
      }

      setSubscribed(true);
      await refresh();
      setBanner({ kind: "success", message: "Push notifications enabled on this device." });
    } catch {
      setBanner({ kind: "error", message: "Push notifications could not be enabled." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setBanner({ kind: "idle", message: "Disabling push notifications..." });

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await fetch("/api/v1/profile/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setSubscribed(false);
      await refresh();
      setBanner({ kind: "success", message: "Push notifications disabled on this device." });
    } catch {
      setBanner({ kind: "error", message: "Push notifications could not be disabled." });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setBanner({ kind: "idle", message: "Sending a test notification..." });

    try {
      const response = await fetch("/api/v1/profile/push/test", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string; sent?: number };

      if (!response.ok) {
        setBanner({ kind: "error", message: data.error ?? "Test notification could not be sent." });
        return;
      }

      setBanner({ kind: "success", message: `Test notification sent to ${data.sent ?? 1} device(s).` });
    } catch {
      setBanner({ kind: "error", message: "Test notification could not be sent." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel preference-panel" aria-labelledby="push-heading">
      <h2 id="push-heading">Push Notifications</h2>
      <p className="player-meta">
        Deliver injury, trade, waiver, and lineup alerts to this device even when Open Fantasy Baseball is closed.
      </p>

      {banner.message ? (
        <div className={banner.kind === "error" ? "status-banner bad" : "status-banner good"}>{banner.message}</div>
      ) : null}

      {!supported ? (
        <div className="empty-state">This browser does not support Web Push notifications.</div>
      ) : status && !status.configured ? (
        <div className="empty-state">Web Push is not configured on this server.</div>
      ) : (
        <div className="push-controls">
          <div className="preference-row">
            <span>
              <span className="player-name">This device</span>
              <span className="player-meta">
                {permission === "denied"
                  ? "Notifications are blocked in your browser settings."
                  : subscribed
                    ? `Subscribed · ${status?.activeCount ?? 1} device(s) active`
                    : "Not subscribed on this device."}
              </span>
            </span>
            {subscribed ? (
              <button className="danger-button" type="button" onClick={disable} disabled={busy}>
                {busy ? "Working..." : "Disable"}
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={enable} disabled={busy || permission === "denied"}>
                {busy ? "Working..." : "Enable"}
              </button>
            )}
          </div>

          {subscribed ? (
            <button className="secondary-button" type="button" onClick={sendTest} disabled={busy}>
              Send Test Notification
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
