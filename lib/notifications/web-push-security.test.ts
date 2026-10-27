import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import https from "node:https";
import type { ClientRequest } from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import webpush from "web-push";
import { pushSubscriptionSchema } from "@/lib/data/push-subscriptions";
import { sendWebPush } from "./web-push";

// Exercise the real web-push URL parser, encryption, and VAPID construction.
// Intercept at HTTPS so no request can reach a public or private destination.
const vapid = webpush.generateVAPIDKeys();
const client = createECDH("prime256v1");
client.generateKeys();
const keys = { p256dh: client.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };

beforeEach(() => {
  vi.stubEnv("WEB_PUSH_PUBLIC_KEY", vapid.publicKey);
  vi.stubEnv("WEB_PUSH_PRIVATE_KEY", vapid.privateKey);
  vi.spyOn(https, "request").mockImplementation(() => {
    const request = new EventEmitter() as ClientRequest;
    request.write = vi.fn(() => true);
    request.end = vi.fn(() => {
      queueMicrotask(() => request.emit("error", new Error("Delivery intercepted by security test")));
      return request;
    });
    return request;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("canonical push delivery destinations", () => {
  it.each([
    ["https://localhost%2epush.apple.com/probe", "localhost.push.apple.com", "/probe"],
    ["https://127.0.0.1%2epush.apple.com/probe", "127.0.0.1.push.apple.com", "/probe"],
    ["https://internal%2enotify.windows.com/probe", "internal.notify.windows.com", "/probe"],
    ["https://%66cm.googleapis.com/fcm/send/token", "fcm.googleapis.com", "/fcm/send/token"],
  ])("uses the validated host even for legacy encoded endpoints: %s", async (endpoint, hostname, path) => {
    expect(pushSubscriptionSchema.parse({ endpoint, keys }).endpoint).toBe(`https://${hostname}${path}`);
    // A stored row can still contain its pre-normalization spelling.
    await sendWebPush({ endpoint, p256dhKey: keys.p256dh, authSecret: keys.auth }, { title: "Test", body: "Test" });
    expect(https.request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ hostname, path }), expect.any(Function));
  });
});
