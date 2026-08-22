import { describe, expect, it } from "vitest";
import {
  bulkFieldingStatsPath,
  bulkSeasonStatsPath,
  deriveHitterEligibilityFromMlbSplits,
  derivePitcherEligibility,
  mapMlbStat,
} from "./mlb-stats-sync";

describe("bulkSeasonStatsPath", () => {
  it("requests MLB's complete player pool instead of qualified players only", () => {
    expect(bulkSeasonStatsPath("hitting", 2026, 1000, 0)).toContain("playerPool=ALL");
  });
});

describe("bulkFieldingStatsPath", () => {
  it("requests the complete MLB player pool for a specific season", () => {
    expect(bulkFieldingStatsPath(2025, 1000, 0)).toBe(
      "/stats?stats=season&group=fielding&season=2025&sportId=1&gameType=R&playerPool=ALL&limit=1000&offset=0",
    );
  });
});

describe("deriveHitterEligibilityFromMlbSplits", () => {
  it("grants Ivan Herrera catcher eligibility from his 2025 MLB fielding line", () => {
    const result = deriveHitterEligibilityFromMlbSplits(
      [
        {
          player: { id: 671056 },
          position: { abbreviation: "C" },
          stat: { gamesStarted: 13, gamesPlayed: 14 },
        },
        {
          player: { id: 671056 },
          position: { abbreviation: "LF" },
          stat: { gamesStarted: 4, gamesPlayed: 4 },
        },
        {
          player: { id: 671056 },
          position: { abbreviation: "DH" },
          stat: { gamesStarted: 89, gamesPlayed: 89 },
        },
      ],
      2025,
      new Map([[671056, "herrera-id"]]),
    );

    expect(result.observations).toEqual([
      { playerId: "herrera-id", season: 2025, position: "C", gamesStarted: 13, appearances: 14 },
      { playerId: "herrera-id", season: 2025, position: "OF", gamesStarted: 4, appearances: 4 },
    ]);
    expect(result.eligibility).toEqual([
      {
        playerId: "herrera-id",
        position: "C",
        qualificationMethod: "fielding",
        lastQualifiedSeason: 2025,
      },
    ]);
  });
});

describe("mapMlbStat", () => {
  it("maps hitting fields to OFB categories with rate stats as strings", () => {
    const stats = mapMlbStat(
      { gamesPlayed: 81, runs: 27, homeRuns: 8, rbi: 43, stolenBases: 0, avg: ".252", ignored: 99 },
      "hitting",
    );
    expect(stats).toEqual({ G: 81, R: 27, HR: 8, RBI: 43, SB: 0, AVG: ".252" });
  });

  it("maps pitching fields to OFB categories", () => {
    const stats = mapMlbStat(
      { gamesPlayed: 22, gamesStarted: 21, wins: 9, saves: 0, strikeOuts: 156, era: "1.47", whip: "0.78" },
      "pitching",
    );
    expect(stats).toEqual({ G: 22, GS: 21, W: 9, SV: 0, K: 156, ERA: "1.47", WHIP: "0.78" });
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
