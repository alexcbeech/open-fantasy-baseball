import { describe, expect, it } from "vitest";
import { buildLiveMatchupUpdate } from "./live-matchup";
import type { LiveLineupEntry, LivePlayerRef } from "./mlb-live";

const ref = (id: string): LivePlayerRef => ({
  id,
  mlb_player_id: 1,
  current_mlb_team_id: 1,
});

const liveEntry = (points: number, stats: Record<string, number | string>): LiveLineupEntry => ({
  state: "Top 5th",
  stats,
  points,
});

const categories = ["HR", "AVG"];

describe("buildLiveMatchupUpdate", () => {
  it("returns a not-live result when nothing is in progress", () => {
    const homeStats = [{ HR: 10, H: 40, AB: 100 }];
    const awayStats = [{ HR: 8, H: 30, AB: 100 }];
    expect(buildLiveMatchupUpdate(true, categories, homeStats, awayStats, [ref("h1")], [ref("a1")], {})).toEqual({
      live: false,
      userScore: 0,
      opponentScore: 0,
      categoryScores: [],
      livePoints: {},
    });
  });

  it("adds live lines onto the period's totals and recomputes the category battle", () => {
    // This week so far: home leads HR 10-8 and AVG .400-.300.
    const homeStats = [{ HR: 10, H: 40, AB: 100 }];
    const awayStats = [{ HR: 8, H: 30, AB: 100 }];
    // Live: the away hitter homers twice and goes 3-3, flipping HR.
    const live = { a1: liveEntry(9, { HR: 3, H: 3, AB: 3 }) };

    const update = buildLiveMatchupUpdate(true, categories, homeStats, awayStats, [ref("h1")], [ref("a1")], live);

    expect(update.live).toBe(true);
    // HR: home 10 vs away 8+3=11 -> away (opponent) wins.
    const hr = update.categoryScores.find((score) => score.category === "HR")!;
    expect(hr.userValue).toBe(10);
    expect(hr.opponentValue).toBe(11);
    expect(hr.result).toBe("loss");
    // AVG: home 40/100=.400 vs away (30+3)/(100+3)=.320 -> home (user) still wins.
    const avg = update.categoryScores.find((score) => score.category === "AVG")!;
    expect(avg.userValue).toBe(".400");
    expect(avg.opponentValue).toBe(".320");
    expect(avg.result).toBe("win");
    // User (home) wins AVG only: 1-1.
    expect(update.userScore).toBe(1);
    expect(update.opponentScore).toBe(1);
    expect(update.livePoints).toEqual({ a1: 9 });
  });

  it("ignores live lines for players no longer in the active lineup", () => {
    // The live map can carry an entry for someone since benched; only current
    // starters' live lines join the totals.
    const update = buildLiveMatchupUpdate(
      true,
      ["HR"],
      [{ HR: 10 }],
      [{ HR: 8 }],
      [ref("h1")],
      [ref("a1")],
      { benched: liveEntry(4, { HR: 5 }) },
    );

    const hr = update.categoryScores[0];
    expect(hr.userValue).toBe(10);
    expect(hr.opponentValue).toBe(8);
  });

  it("flips results and scores to the viewer's perspective when they are away", () => {
    const live = { a1: liveEntry(4, { HR: 1 }) };

    // Viewer is the away team: home still wins HR 10-9, so the viewer loses it.
    const update = buildLiveMatchupUpdate(false, ["HR"], [{ HR: 10 }], [{ HR: 8 }], [ref("h1")], [ref("a1")], live);
    const hr = update.categoryScores[0];
    expect(hr.userValue).toBe(9);
    expect(hr.opponentValue).toBe(10);
    expect(hr.result).toBe("loss");
    expect(update.userScore).toBe(0);
    expect(update.opponentScore).toBe(1);
  });
});
