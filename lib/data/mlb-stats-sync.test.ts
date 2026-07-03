import { describe, expect, it } from "vitest";
import { mapMlbStat } from "./mlb-stats-sync";

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
