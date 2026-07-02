import { describe, expect, it } from "vitest";
import { getFreshnessStatus } from "./admin-runs";

describe("admin run freshness", () => {
  const now = new Date("2026-07-02T16:00:00.000Z");

  it("marks missing data when there is no successful MLB sync", () => {
    expect(getFreshnessStatus(null, now)).toBe("missing");
  });

  it("marks recent MLB syncs as current", () => {
    expect(getFreshnessStatus("2026-07-01T12:00:00.000Z", now)).toBe("ok");
  });

  it("marks old MLB syncs as stale", () => {
    expect(getFreshnessStatus("2026-06-30T03:00:00.000Z", now)).toBe("stale");
  });
});
