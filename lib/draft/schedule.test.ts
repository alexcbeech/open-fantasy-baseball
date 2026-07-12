import { describe, expect, it } from "vitest";
import { draftReminderTime, formatDraftTime } from "./schedule";

describe("draftReminderTime", () => {
  it("fires an hour before a distant start", () => {
    const start = new Date("2026-08-01T23:00:00Z");
    const now = new Date("2026-07-12T12:00:00Z");
    expect(draftReminderTime(start, now)).toEqual(new Date("2026-08-01T22:00:00Z"));
  });

  it("fires immediately when the start is less than an hour away", () => {
    const start = new Date("2026-07-12T12:30:00Z");
    const now = new Date("2026-07-12T12:00:00Z");
    expect(draftReminderTime(start, now)).toEqual(now);
  });
});

describe("formatDraftTime", () => {
  it("renders in Eastern Time with an ET suffix", () => {
    // 23:00 UTC on July 1 is 7:00 PM EDT.
    expect(formatDraftTime(new Date("2026-07-01T23:00:00Z"))).toBe("Jul 1, 2026, 7:00 PM ET");
  });
});
