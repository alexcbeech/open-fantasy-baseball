import { describe, expect, it } from "vitest";
import { draftCountdown } from "./countdown";

describe("draftCountdown", () => {
  it("formats days and a padded clock", () => {
    expect(draftCountdown(90_184_000, 0)).toEqual({
      complete: false,
      totalSeconds: 90_184,
      label: "1d 01h 03m 04s",
    });
  });

  it("omits zero days for near-term drafts", () => {
    expect(draftCountdown(3_661_000, 0).label).toBe("01h 01m 01s");
  });

  it("rounds partial seconds up so the timer does not finish early", () => {
    expect(draftCountdown(1_001, 1_000).totalSeconds).toBe(1);
  });

  it("reports that a reached or past draft is starting", () => {
    expect(draftCountdown(1_000, 1_000)).toEqual({ complete: true, totalSeconds: 0, label: "Starting now…" });
    expect(draftCountdown(1_000, 2_000).complete).toBe(true);
  });
});
