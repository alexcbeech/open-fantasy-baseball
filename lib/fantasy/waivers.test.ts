import { describe, expect, it } from "vitest";
import { nextWaiverProcessingTime } from "./waivers";

describe("nextWaiverProcessingTime", () => {
  // 2026-07-10 is a Friday; 15:00 UTC is past the 04:00 processing hour.
  const fridayAfternoon = new Date("2026-07-10T15:00:00Z");

  it("returns the next day's processing hour when every day processes", () => {
    const next = nextWaiverProcessingTime([0, 1, 2, 3, 4, 5, 6], fridayAfternoon);
    expect(next.toISOString()).toBe("2026-07-11T04:00:00.000Z");
  });

  it("skips to the configured weekday", () => {
    // Wednesday = 3; next Wednesday after Friday Jul 10 is Jul 15.
    const next = nextWaiverProcessingTime([3], fridayAfternoon);
    expect(next.toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("uses today's processing hour when it is still ahead", () => {
    const fridayEarly = new Date("2026-07-10T02:00:00Z");
    const next = nextWaiverProcessingTime([5], fridayEarly);
    expect(next.toISOString()).toBe("2026-07-10T04:00:00.000Z");
  });

  it("treats an empty list as every day", () => {
    const next = nextWaiverProcessingTime([], fridayAfternoon);
    expect(next.toISOString()).toBe("2026-07-11T04:00:00.000Z");
  });
});
