import webpush from "web-push";

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type WebPushTarget = {
  endpoint: string;
  p256dhKey: string;
  authSecret: string;
};

export type WebPushSendResult =
  | { endpoint: string; ok: true }
  | { endpoint: string; ok: false; statusCode: number | null; gone: boolean };

let configured: boolean | undefined;

/**
 * VAPID keys are required to sign Web Push requests. When they are absent the
 * feature degrades gracefully: the UI reports push as unavailable and send
 * helpers become no-ops rather than throwing.
 */
export function isWebPushConfigured() {
  if (configured === undefined) {
    const publicKey = process.env.WEB_PUSH_PUBLIC_KEY;
    const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;

    if (publicKey && privateKey) {
      webpush.setVapidDetails(
        process.env.WEB_PUSH_SUBJECT || "mailto:ops@openfantasybaseball.local",
        publicKey,
        privateKey,
      );
      configured = true;
    } else {
      configured = false;
    }
  }

  return configured;
}

export function getWebPushPublicKey(): string | null {
  return process.env.WEB_PUSH_PUBLIC_KEY || null;
}

/**
 * Deliver a single notification. Returns a structured result instead of
 * throwing so callers can prune subscriptions the push service reports as
 * gone (HTTP 404/410) while treating transient errors as retryable.
 */
export async function sendWebPush(target: WebPushTarget, payload: WebPushPayload): Promise<WebPushSendResult> {
  if (!isWebPushConfigured()) {
    return { endpoint: target.endpoint, ok: false, statusCode: null, gone: false };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dhKey, auth: target.authSecret },
      },
      JSON.stringify(payload),
      { TTL: 60 },
    );

    return { endpoint: target.endpoint, ok: true };
  } catch (error) {
    const statusCode = error instanceof webpush.WebPushError ? error.statusCode : null;
    const gone = statusCode === 404 || statusCode === 410;

    return { endpoint: target.endpoint, ok: false, statusCode, gone };
  }
}
