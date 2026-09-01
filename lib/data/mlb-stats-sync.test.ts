import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bulkFieldingStatsPath,
  bulkSeasonStatsPath,
  deriveHitterEligibilityFromMlbSplits,
  derivePitcherEligibility,
  fetchJson,
  mapMlbStat,
} from "./mlb-stats-sync";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchJson", () => {
  it("retries a timeout and returns the next successful response", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce(new Response(JSON.stringify({ stats: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJson("/people/123/stats?stats=gameLog", "https://stats.example", { retryDelayMs: 0 }),
    ).resolves.toEqual({ stats: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("includes the player request path after exhausting retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(
        Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
      ),
    );

    await expect(
      fetchJson("/people/456/stats?stats=season", "https://stats.example", {
        maxAttempts: 2,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow(
      "MLB Stats API request failed after 2 attempts: /people/456/stats?stats=season (The operation was aborted due to timeout)",
    );
  });

  it("does not retry a permanent client error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchJson("/people/missing", "https://stats.example", { retryDelayMs: 0 }),
    ).rejects.toThrow("MLB Stats API request failed: 404 Not Found /people/missing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

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
      {
        gamesPlayed: 81,
        runs: 27,
        doubles: 12,
        triples: 3,
        homeRuns: 8,
        rbi: 43,
        baseOnBalls: 20,
        stolenBases: 0,
        hitByPitch: 4,
        hits: 60,
        atBats: 200,
        avg: ".252",
        obp: ".315",
        slg: ".410",
        ops: ".725",
        ignored: 99,
      },
      "hitting",
    );
    expect(stats).toEqual({
      G: 81,
      R: 27,
      "2B": 12,
      "3B": 3,
      HR: 8,
      RBI: 43,
      BB: 20,
      SB: 0,
      HBP: 4,
      AVG: ".252",
      OBP: ".315",
      SLG: ".410",
      OPS: ".725",
      H: 60,
      AB: 200,
      "1B": 37,
    });
  });

  it("maps pitching fields to OFB categories", () => {
    const stats = mapMlbStat(
      {
        gamesPlayed: 22,
        gamesStarted: 21,
        wins: 9,
        saves: 0,
        strikeOuts: 156,
        era: "1.47",
        whip: "0.78",
        inningsPitched: "120.2",
        earnedRuns: 20,
        baseOnBalls: 15,
        hits: 70,
        hitBatsmen: 3,
      },
      "pitching",
    );
    expect(stats).toEqual({
      G: 22,
      GS: 21,
      W: 9,
      SV: 0,
      K: 156,
      ERA: "1.47",
      WHIP: "0.78",
      IP: 120.2,
      ER: 20,
      P_BB: 15,
      P_H: 70,
      P_HBP: 3,
      O: 362,
    });
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

  it("does not grant a role before its appearance threshold", () => {
    expect(derivePitcherEligibility(2, 3)).toEqual([]);
    expect(derivePitcherEligibility(1, 3)).toEqual([]);
  });

  it("does not grant RP for a position player's one-off mop-up appearance", () => {
    expect(derivePitcherEligibility(0, 1)).toEqual([]);
  });

  it("returns nothing for a pitcher with no appearances yet", () => {
    expect(derivePitcherEligibility(0, 0)).toEqual([]);
  });

  it("coerces missing or non-finite inputs to zero", () => {
    expect(derivePitcherEligibility(Number.NaN, Number.NaN)).toEqual([]);
    // A start with a missing games count is recognized, but one start is below
    // the eligibility threshold.
    expect(derivePitcherEligibility(1, Number.NaN)).toEqual([]);
  });

  it("never returns RP when games played is fewer than starts (bad data)", () => {
    // Guards against a negative relief count producing an RP tag.
    expect(derivePitcherEligibility(5, 3)).toEqual(["SP"]);
  });
});
