import { afterEach, describe, expect, it, vi } from "vitest";
import { areSignupsEnabled } from "./signups";

afterEach(() => vi.unstubAllEnvs());

describe("areSignupsEnabled", () => {
  it("is disabled by default", () => {
    vi.stubEnv("ALLOW_SIGNUPS", "");
    expect(areSignupsEnabled()).toBe(false);
  });

  it("is disabled for any value other than the literal 'true'", () => {
    vi.stubEnv("ALLOW_SIGNUPS", "1");
    expect(areSignupsEnabled()).toBe(false);
    vi.stubEnv("ALLOW_SIGNUPS", "false");
    expect(areSignupsEnabled()).toBe(false);
    vi.stubEnv("ALLOW_SIGNUPS", "TRUE");
    expect(areSignupsEnabled()).toBe(false);
  });

  it("is enabled only when explicitly set to 'true'", () => {
    vi.stubEnv("ALLOW_SIGNUPS", "true");
    expect(areSignupsEnabled()).toBe(true);
  });
});
