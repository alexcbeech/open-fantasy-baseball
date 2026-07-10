import { describe, expect, it } from "vitest";
import { categoryPoints, rotoStandings } from "./roto";

describe("categoryPoints", () => {
  it("awards teamCount points to the best and 1 to the worst", () => {
    const points = categoryPoints("HR", [
      { teamId: "a", value: 30 },
      { teamId: "b", value: 10 },
      { teamId: "c", value: 20 },
    ]);
    expect(points.get("a")).toBe(3);
    expect(points.get("c")).toBe(2);
    expect(points.get("b")).toBe(1);
  });

  it("inverts direction for ERA and WHIP", () => {
    const points = categoryPoints("ERA", [
      { teamId: "a", value: 4.5 },
      { teamId: "b", value: 2.9 },
    ]);
    expect(points.get("b")).toBe(2);
    expect(points.get("a")).toBe(1);
  });

  it("splits points across ties", () => {
    const points = categoryPoints("SB", [
      { teamId: "a", value: 12 },
      { teamId: "b", value: 12 },
      { teamId: "c", value: 5 },
      { teamId: "d", value: 1 },
    ]);
    // Tied for 1st/2nd: (4 + 3) / 2 each.
    expect(points.get("a")).toBe(3.5);
    expect(points.get("b")).toBe(3.5);
    expect(points.get("c")).toBe(2);
    expect(points.get("d")).toBe(1);
  });

  it("ranks null values (no denominator) below every real value", () => {
    const points = categoryPoints("ERA", [
      { teamId: "a", value: null },
      { teamId: "b", value: 9.9 },
    ]);
    expect(points.get("b")).toBe(2);
    expect(points.get("a")).toBe(1);
  });
});

describe("rotoStandings", () => {
  it("sums category points and ranks descending", () => {
    const standings = rotoStandings(
      [
        { teamId: "a", teamName: "Alpha", values: { HR: 30, ERA: 3.0 } },
        { teamId: "b", teamName: "Beta", values: { HR: 20, ERA: 2.0 } },
        { teamId: "c", teamName: "Gamma", values: { HR: 10, ERA: 4.0 } },
      ],
      ["HR", "ERA"],
    );

    // Alpha: 3 + 2 = 5, Beta: 2 + 3 = 5, Gamma: 1 + 1 = 2 (name tiebreak).
    expect(standings.map((row) => row.teamId)).toEqual(["a", "b", "c"]);
    expect(standings[0].points).toBe(5);
    expect(standings[1].points).toBe(5);
    expect(standings[2].points).toBe(2);
    expect(standings[0].rank).toBe(1);
    expect(standings[2].rank).toBe(3);
  });

  it("treats a missing category value as null (worst)", () => {
    const standings = rotoStandings(
      [
        { teamId: "a", teamName: "Alpha", values: {} },
        { teamId: "b", teamName: "Beta", values: { HR: 1 } },
      ],
      ["HR"],
    );
    expect(standings[0].teamId).toBe("b");
  });
});
