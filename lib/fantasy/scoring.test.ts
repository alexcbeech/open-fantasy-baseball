import { describe, expect, it } from "vitest";
import { calculateSimplePoints, formatScoringType, readPlayerStat } from "./scoring";
import type { Player } from "./types";

const hitter: Player = {
  id: "test-hitter",
  name: "Test Hitter",
  mlbTeam: "OFB",
  positions: ["OF"],
  status: "active",
  availability: "rostered",
  seasonStats: { R: 10, HR: 2, RBI: 8, SB: 3, AVG: ".280" },
  projectedStats: { R: 5, HR: 1, RBI: 4, SB: 2, AVG: ".275" },
};

describe("fantasy scoring helpers", () => {
  it("formats supported league scoring types", () => {
    expect(formatScoringType("h2h-categories")).toBe("H2H Categories");
    expect(formatScoringType("h2h-points")).toBe("H2H Points");
    expect(formatScoringType("roto")).toBe("Rotisserie");
  });

  it("reads season and projected stats", () => {
    expect(readPlayerStat(hitter, "HR")).toBe(2);
    expect(readPlayerStat(hitter, "HR", true)).toBe(1);
    expect(readPlayerStat(hitter, "W")).toBe("-");
  });

  it("calculates simple points from weighted counting stats", () => {
    expect(calculateSimplePoints(hitter)).toBe(32);
  });
});
