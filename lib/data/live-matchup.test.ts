import { describe, expect, it } from "vitest";
import { buildLiveMatchupUpdate } from "./live-matchup";
import type { LiveLineupEntry, LivePlayerRef } from "./mlb-live";

const ref = (id: string): LivePlayerRef => ({
  id,
  mlb_player_id: 1,
  current_mlb_team_id: 1,
});

const liveEntry = (points: number, stats: Record<string, number | string>, state = "Top 5th"): LiveLineupEntry => ({
  state,
  stats,
  points,
});

const categories = ["HR", "AVG"];

type Input = Parameters<typeof buildLiveMatchupUpdate>[0];

const baseInput = (overrides: Partial<Input>): Input => ({
  isHome: true,
  categories,
  homePeriodStats: [],
  awayPeriodStats: [],
  homeActive: [ref("h1")],
  awayActive: [ref("a1")],
  todayLines: {},
  liveGameInProgress: false,
  ...overrides,
});

describe("buildLiveMatchupUpdate", () => {
  it("returns a no-data result when nobody has played today", () => {
    const update = buildLiveMatchupUpdate(
      baseInput({ homePeriodStats: [{ HR: 10, H: 40, AB: 100 }], awayPeriodStats: [{ HR: 8, H: 30, AB: 100 }] }),
    );
    expect(update).toEqual({
      live: false,
      hasTodayStats: false,
      userScore: 0,
      opponentScore: 0,
      categoryScores: [],
      livePoints: {},
    });
  });

  it("adds live lines onto the period's totals and recomputes the category battle", () => {
    const update = buildLiveMatchupUpdate(
      baseInput({
        // This week so far: home leads HR 10-8 and AVG .400-.300.
        homePeriodStats: [{ HR: 10, H: 40, AB: 100 }],
        awayPeriodStats: [{ HR: 8, H: 30, AB: 100 }],
        // Live: the away hitter homers twice and goes 3-3, flipping HR.
        todayLines: { a1: liveEntry(9, { HR: 3, H: 3, AB: 3 }) },
        liveGameInProgress: true,
      }),
    );

    expect(update.live).toBe(true);
    expect(update.hasTodayStats).toBe(true);
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

  it("keeps counting finished games today without flagging the matchup live", () => {
    const update = buildLiveMatchupUpdate(
      baseInput({
        homePeriodStats: [{ HR: 10 }],
        awayPeriodStats: [{ HR: 8 }],
        // Both games ended earlier today; the lines still count.
        todayLines: { h1: liveEntry(4, { HR: 1 }, "Final"), a1: liveEntry(0, { HR: 0 }, "Final") },
        liveGameInProgress: false,
      }),
    );

    expect(update.live).toBe(false);
    expect(update.hasTodayStats).toBe(true);
    const hr = update.categoryScores[0];
    expect(hr.userValue).toBe(11);
    expect(hr.opponentValue).toBe(8);
  });

  it("ignores today's lines for players no longer in the active lineup", () => {
    const update = buildLiveMatchupUpdate(
      baseInput({
        categories: ["HR"],
        homePeriodStats: [{ HR: 10 }],
        awayPeriodStats: [{ HR: 8 }],
        todayLines: { benched: liveEntry(4, { HR: 5 }) },
        liveGameInProgress: true,
      }),
    );

    const hr = update.categoryScores[0];
    expect(hr.userValue).toBe(10);
    expect(hr.opponentValue).toBe(8);
  });

  it("flips results and scores to the viewer's perspective when they are away", () => {
    const update = buildLiveMatchupUpdate(
      baseInput({
        isHome: false,
        categories: ["HR"],
        homePeriodStats: [{ HR: 10 }],
        awayPeriodStats: [{ HR: 8 }],
        todayLines: { a1: liveEntry(4, { HR: 1 }) },
        liveGameInProgress: true,
      }),
    );

    // Viewer is the away team: home still wins HR 10-9, so the viewer loses it.
    const hr = update.categoryScores[0];
    expect(hr.userValue).toBe(9);
    expect(hr.opponentValue).toBe(10);
    expect(hr.result).toBe("loss");
    expect(update.userScore).toBe(0);
    expect(update.opponentScore).toBe(1);
  });
});
