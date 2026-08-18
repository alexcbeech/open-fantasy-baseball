import { describe, expect, it } from "vitest";
import { countsTowardOrdinaryRoster, positionSetsAfterAdd } from "./roster-capacity";

describe("countsTowardOrdinaryRoster", () => {
  it("excludes IL and NA while counting active, bench, and unassigned players", () => {
    expect(countsTowardOrdinaryRoster("IL")).toBe(false);
    expect(countsTowardOrdinaryRoster("NA")).toBe(false);
    expect(countsTowardOrdinaryRoster("BN")).toBe(true);
    expect(countsTowardOrdinaryRoster("C")).toBe(true);
    expect(countsTowardOrdinaryRoster(null)).toBe(true);
  });

  it("leaves IL and NA players out of post-add capacity", () => {
    const postAdd = positionSetsAfterAdd(
      [
        { playerId: "starter", positions: ["C"], slot: "C" },
        { playerId: "injured", positions: ["OF"], slot: "IL" },
        { playerId: "prospect", positions: ["SS"], slot: "NA" },
      ],
      ["1B"],
    );

    expect(postAdd).toEqual([["C"], ["1B"]]);
  });
});
