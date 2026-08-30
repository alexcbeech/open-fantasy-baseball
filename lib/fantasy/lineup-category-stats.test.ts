import { describe, expect, it } from "vitest";
import { formatLineupCategoryValue, lineupCategoryColumns, playerStatSide } from "./lineup-category-stats";

describe("lineup category stats", () => {
  it("adds Yahoo-style context columns ahead of configured scoring categories", () => {
    expect(lineupCategoryColumns("hitting", ["R", "HR", "RBI", "SB", "AVG"])).toEqual([
      "H/AB",
      "R",
      "HR",
      "RBI",
      "SB",
      "AVG",
    ]);
    expect(lineupCategoryColumns("pitching", ["W", "SV", "K", "ERA", "WHIP"])).toEqual([
      "IP",
      "W",
      "SV",
      "K",
      "ERA",
      "WHIP",
    ]);
  });

  it("formats a hitter's current-day line and derives average", () => {
    const stats = { H: 2, AB: 3, R: 1, HR: 1, RBI: 2, SB: 0 };
    expect(formatLineupCategoryValue({ category: "H/AB", hasTodayLine: true, side: "hitting", stats })).toBe("2/3");
    expect(formatLineupCategoryValue({ category: "AVG", hasTodayLine: true, side: "hitting", stats })).toBe(".667");
  });

  it("formats pitching ratios from their scoring components", () => {
    const stats = { O: 14, IP: 4.2, ER: 2, P_BB: 1, P_H: 4, K: 6 };
    expect(formatLineupCategoryValue({ category: "IP", hasTodayLine: true, side: "pitching", stats })).toBe("4.2");
    expect(formatLineupCategoryValue({ category: "ERA", hasTodayLine: true, side: "pitching", stats })).toBe("3.86");
    expect(formatLineupCategoryValue({ category: "WHIP", hasTodayLine: true, side: "pitching", stats })).toBe("1.07");
  });

  it("uses pregame zeros for hitters and dashes for pitchers", () => {
    expect(formatLineupCategoryValue({ category: "H/AB", hasTodayLine: false, side: "hitting", stats: {} })).toBe("0/0");
    expect(formatLineupCategoryValue({ category: "HR", hasTodayLine: false, side: "hitting", stats: {} })).toBe("0");
    expect(formatLineupCategoryValue({ category: "IP", hasTodayLine: false, side: "pitching", stats: {} })).toBe("-");
  });

  it("classifies reserve players from their eligible positions", () => {
    expect(playerStatSide({ positions: ["OF"] })).toBe("hitting");
    expect(playerStatSide({ positions: ["P", "SP"] })).toBe("pitching");
  });
});
