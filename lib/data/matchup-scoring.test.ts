import { describe, expect, it, vi } from "vitest";
import {
  compareCategory,
  computeCategoryValue,
  fantasyPointsByPlayer,
  periodLineupPlayerStats,
  replaceMatchupPlayerScores,
} from "./matchup-scoring";

describe("computeCategoryValue", () => {
  it("sums counting categories across the lineup", () => {
    const stats = [{ HR: 8, RBI: 43 }, { HR: 12, RBI: 30 }];
    expect(computeCategoryValue("HR", stats)).toBe(20);
    expect(computeCategoryValue("RBI", stats)).toBe(73);
  });

  it("computes AVG from total hits over total at-bats, not an average of averages", () => {
    const stats = [
      { H: 30, AB: 100, AVG: ".300" },
      { H: 10, AB: 100, AVG: ".100" },
    ];
    // 40 / 200 = .200, not (.300 + .100) / 2
    expect(computeCategoryValue("AVG", stats)).toBeCloseTo(0.2, 5);
  });

  it("computes ERA and WHIP from components", () => {
    const stats = [
      { IP: 50, ER: 20, P_BB: 15, P_H: 40 },
      { IP: 50, ER: 10, P_BB: 5, P_H: 30 },
    ];
    // ERA = (30 * 9) / 100 = 2.70; WHIP = (20 + 70) / 100 = 0.90
    expect(computeCategoryValue("ERA", stats)).toBeCloseTo(2.7, 5);
    expect(computeCategoryValue("WHIP", stats)).toBeCloseTo(0.9, 5);
  });

  it("treats IP as baseball notation (6.2 = 6 and 2/3 innings) when summing", () => {
    const stats = [
      { IP: "6.2", ER: 2 },
      { IP: "6.2", ER: 2 },
    ];
    // 13⅓ innings, not 12.4: ERA = (4 * 9) / 13.333... = 2.70
    expect(computeCategoryValue("IP", stats)).toBeCloseTo(13.3333, 3);
    expect(computeCategoryValue("ERA", stats)).toBeCloseTo(2.7, 5);
  });

  it("returns null for rate categories with no innings/at-bats", () => {
    expect(computeCategoryValue("ERA", [{ HR: 5 }])).toBeNull();
    expect(computeCategoryValue("AVG", [{ HR: 5 }])).toBeNull();
  });
});

describe("compareCategory", () => {
  it("awards higher totals for counting stats", () => {
    expect(compareCategory("HR", 20, 12)).toBe("win");
    expect(compareCategory("HR", 12, 20)).toBe("loss");
    expect(compareCategory("HR", 12, 12)).toBe("tie");
  });

  it("awards lower ERA and WHIP", () => {
    expect(compareCategory("ERA", 2.7, 3.4)).toBe("win");
    expect(compareCategory("WHIP", 1.3, 1.1)).toBe("loss");
  });

  it("ties rate categories when either side has no denominator", () => {
    // No innings pitched is a no-contest, not an automatic 0.00 ERA win.
    expect(compareCategory("ERA", null, 3.4)).toBe("tie");
    expect(compareCategory("WHIP", 1.1, null)).toBe("tie");
    expect(compareCategory("AVG", null, null)).toBe("tie");
  });
});

describe("fantasyPointsByPlayer", () => {
  it("totals each player's game lines across the matchup period", () => {
    expect(
      fantasyPointsByPlayer([
        { playerId: "hitter", stats: { HR: 1, R: 1 } },
        { playerId: "hitter", stats: { RBI: 2 } },
        { playerId: "pitcher", stats: { IP: 2, K: 3 } },
      ]),
    ).toEqual({ hitter: 16.1, pitcher: 15 });
  });

  it("replaces the persisted matchup player-score snapshot in one batch", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const written = await replaceMatchupPlayerScores({ query }, "matchup", [
      { teamId: "home", scores: { hitter: 7, pitcher: 9 } },
      { teamId: "away", scores: { opponent: 4.5 } },
    ]);

    expect(written).toBe(3);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toMatch(/delete from matchup_player_score/);
    expect(query.mock.calls[1][1]).toEqual([
      "matchup",
      ["home", "home", "away"],
      ["hitter", "pitcher", "opponent"],
      [7, 9, 4.5],
    ]);
  });
});

describe("periodLineupPlayerStats", () => {
  it("scores a game line only from the active lineup effective on that game date", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ player_id: "active-player", slot: "SP", stats: { HR: 1, R: 1, IP: 6, K: 8 } }],
    });

    const result = await periodLineupPlayerStats(
      { query },
      "team-1",
      "2026-08-17T04:00:00.000Z",
      "2026-08-24T04:00:00.000Z",
    );

    const sql = query.mock.calls[0][0];
    expect(sql).toContain("le.lineup_date <= psl.stat_date");
    expect(sql).toContain("order by le.lineup_date desc");
    expect(sql).toContain("lineup_on_date.slot not in ('BN', 'IL', 'NA')");
    expect(sql).toContain("lineup_on_date.slot");
    expect(result).toEqual([{ playerId: "active-player", stats: { IP: 6, K: 8 } }]);
  });
});
