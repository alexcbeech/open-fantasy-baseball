import { describe, expect, it } from "vitest";
import { deriveHitterPositionEligibility, normalizeHitterFieldingPosition } from "./position-eligibility-rules";

describe("normalizeHitterFieldingPosition", () => {
  it("combines all three outfield positions", () => {
    expect(normalizeHitterFieldingPosition("LF")).toBe("OF");
    expect(normalizeHitterFieldingPosition("CF")).toBe("OF");
    expect(normalizeHitterFieldingPosition("RF")).toBe("OF");
  });

  it("does not treat DH, UTIL, or P as a defensive hitter position", () => {
    expect(normalizeHitterFieldingPosition("DH")).toBeNull();
    expect(normalizeHitterFieldingPosition("UTIL")).toBeNull();
    expect(normalizeHitterFieldingPosition("P")).toBeNull();
  });
});
describe("deriveHitterPositionEligibility", () => {
  it("qualifies a position after five starts", () => {
    expect(deriveHitterPositionEligibility([{ position: "C", gamesStarted: 5, appearances: 5 }])).toEqual([
      { position: "C", gamesStarted: 5, appearances: 5 },
    ]);
  });

  it("qualifies a position after ten appearances", () => {
    expect(deriveHitterPositionEligibility([{ position: "2B", gamesStarted: 2, appearances: 10 }])).toEqual([
      { position: "2B", gamesStarted: 2, appearances: 10 },
    ]);
  });

  it("does not qualify at four starts and nine appearances", () => {
    expect(deriveHitterPositionEligibility([{ position: "3B", gamesStarted: 4, appearances: 9 }])).toEqual([]);
  });

  it("aggregates starts and appearances across all outfield positions", () => {
    expect(
      deriveHitterPositionEligibility([
        { position: "LF", gamesStarted: 2, appearances: 4 },
        { position: "CF", gamesStarted: 2, appearances: 3 },
        { position: "RF", gamesStarted: 1, appearances: 3 },
      ]),
    ).toEqual([{ position: "OF", gamesStarted: 5, appearances: 10 }]);
  });

  it("sanitizes invalid and contradictory counts", () => {
    expect(
      deriveHitterPositionEligibility([
        { position: "SS", gamesStarted: Number.NaN, appearances: -4 },
        { position: "SS", gamesStarted: 5.9, appearances: 5 },
      ]),
    ).toEqual([{ position: "SS", gamesStarted: 5, appearances: 5 }]);
  });
});
