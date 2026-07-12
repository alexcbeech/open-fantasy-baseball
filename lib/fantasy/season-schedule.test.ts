import { describe, expect, it } from "vitest";
import {
  buildSeasonSchedule,
  currentSeasonYear,
  formatRecord,
  playoffRoundCount,
  rankStandings,
  roundRobinPairs,
  seasonEndBoundary,
} from "./season-schedule";

const teams4 = ["t1", "t2", "t3", "t4"];

describe("roundRobinPairs", () => {
  it("pairs every team exactly once per week", () => {
    for (let week = 0; week < 6; week += 1) {
      const pairs = roundRobinPairs(teams4, week);
      const seen = pairs.flatMap((pair) => [pair.homeTeamId, pair.awayTeamId]);
      expect(pairs).toHaveLength(2);
      expect(new Set(seen).size).toBe(4);
    }
  });

  it("cycles through every opponent before repeating", () => {
    const opponentsOfT1 = new Set<string>();

    for (let week = 0; week < 3; week += 1) {
      const pair = roundRobinPairs(teams4, week).find((p) => p.homeTeamId === "t1" || p.awayTeamId === "t1");
      opponentsOfT1.add(pair!.homeTeamId === "t1" ? pair!.awayTeamId : pair!.homeTeamId);
    }

    expect(opponentsOfT1).toEqual(new Set(["t2", "t3", "t4"]));
  });

  it("gives one team a bye each week with an odd count", () => {
    const teams = ["a", "b", "c"];
    const byes = new Set<string>();

    for (let week = 0; week < 3; week += 1) {
      const pairs = roundRobinPairs(teams, week);
      expect(pairs).toHaveLength(1);
      const playing = new Set(pairs.flatMap((pair) => [pair.homeTeamId, pair.awayTeamId]));
      byes.add(teams.find((team) => !playing.has(team))!);
    }

    // Every team sits exactly once across the cycle.
    expect(byes).toEqual(new Set(teams));
  });
});

describe("currentSeasonYear", () => {
  it("targets the current year mid-season", () => {
    expect(currentSeasonYear(new Date("2026-07-12T15:00:00Z"))).toBe(2026);
  });

  it("targets the current year during spring training", () => {
    expect(currentSeasonYear(new Date("2026-02-20T15:00:00Z"))).toBe(2026);
  });

  it("targets next year once the fantasy season has ended", () => {
    expect(currentSeasonYear(new Date("2026-11-15T15:00:00Z"))).toBe(2027);
  });

  it("rolls over exactly at the season-end boundary", () => {
    const boundary = seasonEndBoundary(2026);
    expect(currentSeasonYear(new Date(boundary.getTime() - 1))).toBe(2026);
    expect(currentSeasonYear(boundary)).toBe(2027);
  });
});

describe("buildSeasonSchedule", () => {
  const from = new Date("2026-07-10T15:00:00Z"); // a Friday

  it("builds weekly periods through season end plus playoff rounds", () => {
    const periods = buildSeasonSchedule({ teamIds: teams4, seasonYear: 2026, playoffTeamCount: 2, from });
    const regular = periods.filter((period) => !period.isPlayoff);
    const playoffs = periods.filter((period) => period.isPlayoff);

    expect(playoffs).toHaveLength(1); // 2-team playoff = championship only
    expect(playoffs[0].label).toBe("Championship");
    expect(playoffs[0].matchups).toEqual([]);
    expect(regular[0].label).toBe("Week 1");
    expect(regular[0].startsAt).toEqual(from);
    expect(regular.every((period) => period.matchups.length === 2)).toBe(true);

    // Contiguous windows, ending by the season boundary + playoff weeks.
    for (let index = 1; index < periods.length; index += 1) {
      expect(periods[index].startsAt).toEqual(periods[index - 1].endsAt);
    }
  });

  it("labels multi-round playoffs and sizes them to the field", () => {
    const periods = buildSeasonSchedule({ teamIds: teams4, seasonYear: 2026, playoffTeamCount: 4, from });
    const playoffs = periods.filter((period) => period.isPlayoff);

    expect(playoffs.map((period) => period.label)).toEqual(["Playoffs Round 1", "Championship"]);
    expect(playoffs.map((period) => period.playoffRound)).toEqual([1, 2]);
  });

  it("merges a stub first week into the following full week", () => {
    const sunday = new Date("2026-07-12T15:00:00Z"); // < 2 days before Monday boundary
    const periods = buildSeasonSchedule({ teamIds: teams4, seasonYear: 2026, playoffTeamCount: 2, from: sunday });
    const firstMs = periods[0].endsAt.getTime() - periods[0].startsAt.getTime();

    expect(firstMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
  });

  it("appends past the season boundary when the calendar is out of weeks", () => {
    const late = new Date("2026-09-25T15:00:00Z");
    const periods = buildSeasonSchedule({ teamIds: teams4, seasonYear: 2026, playoffTeamCount: 4, from: late });

    expect(periods.filter((period) => !period.isPlayoff).length).toBeGreaterThanOrEqual(1);
    expect(periods.filter((period) => period.isPlayoff)).toHaveLength(2);
  });

  it("continues week numbering when asked", () => {
    const periods = buildSeasonSchedule({
      teamIds: teams4,
      seasonYear: 2026,
      playoffTeamCount: 2,
      from,
      startWeekNumber: 3,
    });
    expect(periods[0].label).toBe("Week 3");
  });

  it("offsets the pairing rotation so extensions don't repeat prior weeks", () => {
    const base = buildSeasonSchedule({ teamIds: teams4, seasonYear: 2026, playoffTeamCount: 2, from });
    const extended = buildSeasonSchedule({
      teamIds: teams4,
      seasonYear: 2026,
      playoffTeamCount: 2,
      from,
      rotationOffset: 1,
    });
    const key = (period: (typeof base)[number]) =>
      period.matchups.map((pair) => [pair.homeTeamId, pair.awayTeamId].sort().join("v")).sort().join("|");

    expect(key(extended[0])).toBe(key(base[1]));
    expect(key(extended[0])).not.toBe(key(base[0]));
  });
});

describe("seasonEndBoundary", () => {
  it("lands on a Monday at the season's end", () => {
    const end = seasonEndBoundary(2026);
    expect(end.getUTCDay()).toBe(1);
    expect(end.getUTCMonth()).toBe(8); // a September Monday (before Oct 1)
  });
});

describe("playoffRoundCount", () => {
  it("sizes single-elimination rounds", () => {
    expect(playoffRoundCount(0)).toBe(0);
    expect(playoffRoundCount(2)).toBe(1);
    expect(playoffRoundCount(4)).toBe(2);
    expect(playoffRoundCount(6)).toBe(3);
    expect(playoffRoundCount(8)).toBe(3);
  });
});

describe("standings helpers", () => {
  it("formats records with ties only when present", () => {
    expect(formatRecord({ wins: 3, losses: 1, ties: 0 })).toBe("3-1");
    expect(formatRecord({ wins: 3, losses: 1, ties: 2 })).toBe("3-1-2");
  });

  it("ranks by wins then points then name", () => {
    const ranked = rankStandings([
      { teamId: "a", teamName: "Alpha", wins: 2, losses: 1, ties: 0, points: 10 },
      { teamId: "b", teamName: "Beta", wins: 3, losses: 0, ties: 0, points: 5 },
      { teamId: "c", teamName: "Gamma", wins: 2, losses: 1, ties: 0, points: 12 },
    ]);
    expect(ranked.map((record) => record.teamId)).toEqual(["b", "c", "a"]);
  });
});
