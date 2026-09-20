import { describe, expect, it } from "vitest";
import { consolationField, pairPlayoffRound, playoffWinner, rankPostseason, survivorsAfterRound } from "./playoffs";

const team = (seed: number) => ({ teamId: `t${seed}`, seed });

describe("consolation placements", () => {
  it("keeps championship finalists above consolation finalists despite upsets and scores", () => {
    const field = [{ ...team(1), bracket: 0 }, { ...team(2), bracket: 0 }, ...consolationField(["t3", "t4"], 1)];
    const results = [
      { round: 1, homeTeamId: "t1", awayTeamId: "t2", homeScore: 1, awayScore: 2 },
      { round: 1, homeTeamId: "t3", awayTeamId: "t4", homeScore: 100, awayScore: 200 },
    ];
    expect(rankPostseason(field, results).map((entry) => entry.teamId)).toEqual(["t2", "t1", "t4", "t3"]);
  });
  it("splits large consolation fields into seeded placement brackets within the calendar", () => {
    const field = consolationField(["t3", "t4", "t5", "t6", "t7"], 2);
    expect(field.map((entry) => entry.bracket)).toEqual([1, 1, 1, 1, 2]);
    expect(pairPlayoffRound(field.filter((entry) => entry.bracket === 2), 1).pairs).toEqual([]);
  });
  it("ranks later elimination ahead of earlier losses and breaks tied scores by seed", () => {
    const field = consolationField(["t3", "t4", "t5", "t6"], 2);
    expect(rankPostseason(field, [
      { round: 1, homeTeamId: "t3", awayTeamId: "t6", homeScore: 2, awayScore: 3 },
      { round: 1, homeTeamId: "t4", awayTeamId: "t5", homeScore: 2, awayScore: 2 },
      { round: 2, homeTeamId: "t4", awayTeamId: "t6", homeScore: 2, awayScore: 2 },
    ]).map((entry) => entry.teamId)).toEqual(["t4", "t6", "t3", "t5"]);
  });
});

describe("pairPlayoffRound", () => {
  it("pairs a power-of-two field best-vs-worst with no byes", () => {
    const plan = pairPlayoffRound([team(1), team(2), team(3), team(4)], 2);
    expect(plan.byes).toEqual([]);
    expect(plan.pairs).toEqual([
      { home: team(1), away: team(4) },
      { home: team(2), away: team(3) },
    ]);
  });

  it("gives byes to top seeds in a six-team field", () => {
    const plan = pairPlayoffRound([1, 2, 3, 4, 5, 6].map(team), 4);
    expect(plan.byes).toEqual([team(1), team(2)]);
    expect(plan.pairs).toEqual([
      { home: team(3), away: team(6) },
      { home: team(4), away: team(5) },
    ]);
  });

  it("re-seeds later rounds from the surviving field", () => {
    // After a 6-team round 1: seeds 1, 2 (byes) plus winners 5 and 3.
    const plan = pairPlayoffRound([team(1), team(2), team(3), team(5)], 2);
    expect(plan.byes).toEqual([]);
    expect(plan.pairs).toEqual([
      { home: team(1), away: team(5) },
      { home: team(2), away: team(3) },
    ]);
  });

  it("pairs the championship", () => {
    const plan = pairPlayoffRound([team(2), team(1)], 1);
    expect(plan.pairs).toEqual([{ home: team(1), away: team(2) }]);
  });
});

describe("survivorsAfterRound", () => {
  it("halves the bracket every round", () => {
    expect(survivorsAfterRound(3, 1)).toBe(4);
    expect(survivorsAfterRound(3, 2)).toBe(2);
    expect(survivorsAfterRound(3, 3)).toBe(1);
  });
});

describe("playoffWinner", () => {
  it("advances the higher score", () => {
    expect(playoffWinner({ ...team(4), score: 7 }, { ...team(1), score: 3 }).teamId).toBe("t4");
  });

  it("breaks ties toward the better seed", () => {
    expect(playoffWinner({ ...team(4), score: 5 }, { ...team(1), score: 5 }).teamId).toBe("t1");
  });
});
