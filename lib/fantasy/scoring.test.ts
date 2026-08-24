import { describe, expect, it } from "vitest";
import {
  buildPointsWeightMap,
  calculateFantasyPoints,
  calculateSimplePoints,
  formatScoringType,
  yahooPointsWeights,
  readPlayerStat,
} from "./scoring";
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
    expect(calculateSimplePoints(hitter)).toBeCloseTo(67.6, 5);
  });

  it("scores an arbitrary stat line and ignores non-scoring rate stats", () => {
    expect(calculateFantasyPoints({ R: 27, HR: 8, RBI: 43, SB: 0, AVG: ".252" })).toBeCloseTo(216.2, 5);
    expect(calculateFantasyPoints({ W: 9, SV: 0, K: 156, ERA: "1.47" })).toBe(540);
  });

  it("matches Yahoo's complete batter and pitcher formula", () => {
    const batter = { "1B": 2, "2B": 1, "3B": 1, HR: 1, R: 2, RBI: 3, BB: 1, SB: 1, HBP: 1 };
    const pitcher = { SV: 1, W: 1, K: 5, ER: 2, O: 18, P_BB: 2, P_H: 4, P_HBP: 1 };

    expect(calculateFantasyPoints(batter)).toBeCloseTo(47.5, 5);
    expect(calculateFantasyPoints(pitcher)).toBeCloseTo(33.9, 5);
    expect(yahooPointsWeights).toMatchObject({ "1B": 2.6, HR: 10.4, P_BB: -1.3, P_H: -1.3 });
  });

  it("derives singles and outs and supports legacy pitching component keys", () => {
    expect(calculateFantasyPoints({ H: 4, "2B": 1, "3B": 1, HR: 1 })).toBeCloseTo(26, 5);
    expect(calculateFantasyPoints({ IP: "6.2", K: 4, ER: 2, BB: 1, HA: 5 })).toBeCloseTo(18.2, 5);
  });

  it("builds side-aware league weights for overlapping Yahoo category names", () => {
    expect(
      buildPointsWeightMap([
        { category: "BB", side: "hitting", points_weight: "2.6" },
        { category: "BB", side: "pitching", points_weight: "-1.3" },
      ]),
    ).toEqual({ BB: 2.6, P_BB: -1.3 });
  });
});
