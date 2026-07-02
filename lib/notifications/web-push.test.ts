import { describe, expect, it } from "vitest";
import { getWebPushPublicKey, isWebPushConfigured, sendWebPush } from "./web-push";

// Vitest does not load .env.local, so WEB_PUSH_* are unset here. This locks in
// the graceful-degradation contract the UI and routes depend on when a server
// has no VAPID keys.
describe("web-push without VAPID configuration", () => {
  it("reports the feature as unconfigured", () => {
    expect(isWebPushConfigured()).toBe(false);
    expect(getWebPushPublicKey()).toBeNull();
  });

  it("returns a non-throwing not-configured result instead of attempting delivery", async () => {
    const result = await sendWebPush(
      { endpoint: "https://push.example.com/x", p256dhKey: "key", authSecret: "secret" },
      { title: "t", body: "b" },
    );

    expect(result).toEqual({ endpoint: "https://push.example.com/x", ok: false, statusCode: null, gone: false });
  });
});
