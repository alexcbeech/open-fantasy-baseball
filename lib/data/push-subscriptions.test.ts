import { describe, expect, it } from "vitest";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "./push-subscriptions";

describe("pushSubscriptionSchema", () => {
  it("accepts a well-formed browser PushSubscription", () => {
    const parsed = pushSubscriptionSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "BPublicKeyMaterial", auth: "authSecret" },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a non-URL endpoint", () => {
    const parsed = pushSubscriptionSchema.safeParse({
      endpoint: "not-a-url",
      keys: { p256dh: "key", auth: "secret" },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a subscription missing key material", () => {
    const parsed = pushSubscriptionSchema.safeParse({
      endpoint: "https://push.example.com/xyz",
      keys: { p256dh: "", auth: "secret" },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("pushUnsubscribeSchema", () => {
  it("requires a valid endpoint URL", () => {
    expect(pushUnsubscribeSchema.safeParse({ endpoint: "https://push.example.com/1" }).success).toBe(true);
    expect(pushUnsubscribeSchema.safeParse({ endpoint: "" }).success).toBe(false);
  });
});
