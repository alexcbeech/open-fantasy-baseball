import { describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { isAllowedPushEndpoint } from "./push-endpoint";
import { sendWebPush } from "./web-push";
import { pushSubscriptionSchema } from "@/lib/data/push-subscriptions";

vi.mock("web-push", () => ({ default: { sendNotification: vi.fn(), setVapidDetails: vi.fn() } }));

describe("Web Push SSRF protection", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token",
    "https://wns2.notify.windows.com/w/?token=abc",
  ])("accepts browser push endpoints: %s", endpoint => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh: "key", auth: "secret" } }).success).toBe(true);
  });

  it.each([
    "https://127.0.0.1/internal", "https://[::1]/internal",
    "http://169.254.169.254/latest/meta-data/", "https://internal.example/",
    "http://fcm.googleapis.com/token", "https://fcm.googleapis.com:8443/token",
    "https://fcm.googleapis.com.evil.test/token", "https://evilpush.apple.com/token",
    "https://fcm.googleapis.com@evil.test/token", "https://user:pass@fcm.googleapis.com/token",
  ])("rejects unsafe registration and stored endpoints without delivery: %s", async endpoint => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh: "key", auth: "secret" } }).success).toBe(false);
    expect(await sendWebPush({ endpoint, p256dhKey: "key", authSecret: "secret" }, { title: "t", body: "b" }))
      .toMatchObject({ ok: false, gone: true });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });
});
