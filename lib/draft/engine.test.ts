import { describe, expect, it } from "vitest";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import { draftRounds, linearOrderStrategy, orderStrategyFor, roundForPick, snakeOrderStrategy, totalPicks } from "./engine";

describe("snakeOrderStrategy", () => {
  it.each([4, 12, 20])("reflects at round boundaries for %i teams", (teamCount) => {
    // Round 1 runs 0..N-1.
    expect(snakeOrderStrategy.teamIndexForPick(1, teamCount)).toBe(0);
    expect(snakeOrderStrategy.teamIndexForPick(teamCount, teamCount)).toBe(teamCount - 1);
    // Round 2 reverses: pick N+1 goes back to the last team.
    expect(snakeOrderStrategy.teamIndexForPick(teamCount + 1, teamCount)).toBe(teamCount - 1);
    expect(snakeOrderStrategy.teamIndexForPick(teamCount * 2, teamCount)).toBe(0);
    // Round 3 runs forward again.
    expect(snakeOrderStrategy.teamIndexForPick(teamCount * 2 + 1, teamCount)).toBe(0);
  });

  it("gives every team exactly one pick per round", () => {
    const teamCount = 12;

    for (let round = 0; round < 5; round++) {
      const seen = new Set<number>();

      for (let offset = 1; offset <= teamCount; offset++) {
        seen.add(snakeOrderStrategy.teamIndexForPick(round * teamCount + offset, teamCount));
      }

      expect(seen.size).toBe(teamCount);
    }
  });
});

describe("linearOrderStrategy", () => {
  it("repeats the same order every round", () => {
    expect(linearOrderStrategy.teamIndexForPick(1, 10)).toBe(0);
    expect(linearOrderStrategy.teamIndexForPick(11, 10)).toBe(0);
    expect(linearOrderStrategy.teamIndexForPick(20, 10)).toBe(9);
  });
});

describe("orderStrategyFor", () => {
  it("uses snake for snake drafts and linear otherwise", () => {
    expect(orderStrategyFor("snake")).toBe(snakeOrderStrategy);
    expect(orderStrategyFor("offline")).toBe(linearOrderStrategy);
  });
});

describe("roundForPick", () => {
  it("computes round and pick-in-round from the overall pick", () => {
    expect(roundForPick(1, 12)).toEqual({ round: 1, pickInRound: 1 });
    expect(roundForPick(12, 12)).toEqual({ round: 1, pickInRound: 12 });
    expect(roundForPick(13, 12)).toEqual({ round: 2, pickInRound: 1 });
    expect(roundForPick(25, 12)).toEqual({ round: 3, pickInRound: 1 });
  });
});

describe("draftRounds", () => {
  it("counts every slot except IL and NA", () => {
    // Default slots: C1 1B1 2B1 3B1 SS1 OF3 UTIL2 SP2 RP2 P4 BN5 = 23 (IL 4, NA 0 excluded).
    expect(draftRounds(defaultRosterSlots)).toBe(23);
    expect(totalPicks(draftRounds(defaultRosterSlots), 12)).toBe(276);
  });
});
