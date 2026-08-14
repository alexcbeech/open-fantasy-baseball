import { afterEach, describe, expect, it, vi } from "vitest";
import { measureServerOperation } from "./server-performance";

const originalSetting = process.env.OFB_PERFORMANCE_LOGGING;

afterEach(() => {
  if (originalSetting === undefined) {
    delete process.env.OFB_PERFORMANCE_LOGGING;
  } else {
    process.env.OFB_PERFORMANCE_LOGGING = originalSetting;
  }
  vi.restoreAllMocks();
});

describe("measureServerOperation", () => {
  it("does not log unless performance logging is enabled", async () => {
    delete process.env.OFB_PERFORMANCE_LOGGING;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(await measureServerOperation("players", async () => 42)).toBe(42);
    expect(info).not.toHaveBeenCalled();
  });

  it("logs structured timing and preserves the operation result", async () => {
    process.env.OFB_PERFORMANCE_LOGGING = "true";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    expect(await measureServerOperation("players", async () => 42)).toBe(42);
    const event = JSON.parse(String(info.mock.calls[0][0])) as Record<string, unknown>;
    expect(event).toMatchObject({ event: "ofb.server_timing", name: "players" });
    expect(event.durationMs).toEqual(expect.any(Number));
  });
});
