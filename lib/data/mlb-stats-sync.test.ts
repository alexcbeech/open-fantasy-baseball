import { describe, expect, it } from "vitest";
import { derivePitcherEligibility, mapMlbStat } from "./mlb-stats-sync";

describe("mapMlbStat", () => {
  it("maps hitting fields to OFB categories with rate stats as strings", () => {
    const stats = mapMlbStat({ runs: 27, homeRuns: 8, rbi: 43, stolenBases: 0, avg: ".252", ignored: 99 }, "hitting");
    expect(stats).toEqual({ R: 27, HR: 8, RBI: 43, SB: 0, AVG: ".252" });
  });

  it("maps pitching fields to OFB categories", () => {
    const stats = mapMlbStat({ wins: 9, saves: 0, strikeOuts: 156, era: "1.47", whip: "0.78" }, "pitching");
    expect(stats).toEqual({ W: 9, SV: 0, K: 156, ERA: "1.47", WHIP: "0.78" });
  });

  it("keeps counting stats numeric and rate stats textual", () => {
    const stats = mapMlbStat({ homeRuns: "8", avg: ".252" }, "hitting");
    expect(stats.HR).toBe(8);
    expect(stats.AVG).toBe(".252");
  });

  it("skips missing, null, and empty values", () => {
    const stats = mapMlbStat({ runs: 5, homeRuns: null, rbi: "", stolenBases: undefined }, "hitting");
    expect(stats).toEqual({ R: 5 });
  });

  it("returns an empty map for missing stat objects", () => {
    expect(mapMlbStat(undefined, "hitting")).toEqual({});
  });
});

describe("derivePitcherEligibility", () => {
  it("tags a full-time starter SP only", () => {
    // Paul Skenes: 32 GS / 32 G.
    expect(derivePitcherEligibility(32, 32)).toEqual(["SP"]);
  });

  it("tags a full-time reliever RP only", () => {
    // 0 GS / 60 relief appearances.
    expect(derivePitcherEligibility(0, 60)).toEqual(["RP"]);
  });

  it("tags a swingman both SP and RP", () => {
    // Nick Martinez: 26 GS / 40 G -> 14 relief appearances.
    expect(derivePitcherEligibility(26, 40)).toEqual(["SP", "RP"]);
  });

  it("falls back to the dominant role on a small sample", () => {
    // Two starts, one relief appearance: neither clears the threshold.
    expect(derivePitcherEligibility(2, 3)).toEqual(["SP"]);
    // One start, two relief appearances.
    expect(derivePitcherEligibility(1, 3)).toEqual(["RP"]);
  });

  it("returns nothing for a pitcher with no appearances yet", () => {
    expect(derivePitcherEligibility(0, 0)).toEqual([]);
  });

  it("coerces missing or non-finite inputs to zero", () => {
    expect(derivePitcherEligibility(Number.NaN, Number.NaN)).toEqual([]);
    // A start with a missing games count still counts as one appearance.
    expect(derivePitcherEligibility(1, Number.NaN)).toEqual(["SP"]);
  });

  it("never returns RP when games played is fewer than starts (bad data)", () => {
    // Guards against a negative relief count producing an RP tag.
    expect(derivePitcherEligibility(5, 3)).toEqual(["SP"]);
  });
});
