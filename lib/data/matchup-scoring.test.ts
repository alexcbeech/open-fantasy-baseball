import { describe, expect, it } from "vitest";
import { compareCategory, computeCategoryValue } from "./matchup-scoring";

describe("computeCategoryValue", () => {
  it("sums counting categories across the lineup", () => {
    const stats = [{ HR: 8, RBI: 43 }, { HR: 12, RBI: 30 }];
    expect(computeCategoryValue("HR", stats)).toBe(20);
    expect(computeCategoryValue("RBI", stats)).toBe(73);
  });

  it("computes AVG from total hits over total at-bats, not an average of averages", () => {
    const stats = [
      { H: 30, AB: 100, AVG: ".300" },
      { H: 10, AB: 100, AVG: ".100" },
    ];
    // 40 / 200 = .200, not (.300 + .100) / 2
    expect(computeCategoryValue("AVG", stats)).toBeCloseTo(0.2, 5);
  });

  it("computes ERA and WHIP from components", () => {
    const stats = [
      { IP: 50, ER: 20, BB: 15, HA: 40 },
      { IP: 50, ER: 10, BB: 5, HA: 30 },
    ];
    // ERA = (30 * 9) / 100 = 2.70; WHIP = (20 + 70) / 100 = 0.90
    expect(computeCategoryValue("ERA", stats)).toBeCloseTo(2.7, 5);
    expect(computeCategoryValue("WHIP", stats)).toBeCloseTo(0.9, 5);
  });

  it("returns 0 for rate categories with no innings/at-bats", () => {
    expect(computeCategoryValue("ERA", [{ HR: 5 }])).toBe(0);
    expect(computeCategoryValue("AVG", [{ HR: 5 }])).toBe(0);
  });
});

describe("compareCategory", () => {
  it("awards higher totals for counting stats", () => {
    expect(compareCategory("HR", 20, 12)).toBe("win");
    expect(compareCategory("HR", 12, 20)).toBe("loss");
    expect(compareCategory("HR", 12, 12)).toBe("tie");
  });

  it("awards lower ERA and WHIP", () => {
    expect(compareCategory("ERA", 2.7, 3.4)).toBe("win");
    expect(compareCategory("WHIP", 1.3, 1.1)).toBe("loss");
  });
});
