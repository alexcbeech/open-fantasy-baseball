import { describe, expect, it } from "vitest";
import { pairPlayoffRound, playoffWinner, survivorsAfterRound } from "./playoffs";

const team = (seed: number) => ({ teamId: `t${seed}`, seed });

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
