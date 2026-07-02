import { describe, expect, it } from "vitest";
import { DerivedProjectionsProvider, deriveRosProjection } from "./projections-sync";

describe("deriveRosProjection", () => {
  it("paces counting stats across the remaining season", () => {
    const projection = deriveRosProjection(
      { HR: 20, RBI: 60 },
      null,
      { remainingFraction: 0.5, recentWeight: 0 },
    );

    // With no recent window and full weight on season pace, ROS = season * remainingFraction.
    expect(projection.HR).toBe(10);
    expect(projection.RBI).toBe(30);
  });

  it("blends rate stats toward recent form", () => {
    const projection = deriveRosProjection(
      { AVG: 0.3 },
      { AVG: 0.2 },
      { remainingFraction: 0.5, recentWeight: 0.5 },
    );

    // 0.3 * 0.5 + 0.2 * 0.5 = 0.25
    expect(projection.AVG).toBe(0.25);
  });

  it("pulls counting projections toward a hot streak", () => {
    const cold = deriveRosProjection({ HR: 10 }, { HR: 1 }, { remainingFraction: 0.5, recentWeight: 0.5 });
    const hot = deriveRosProjection({ HR: 10 }, { HR: 6 }, { remainingFraction: 0.5, recentWeight: 0.5 });

    expect(Number(hot.HR)).toBeGreaterThan(Number(cold.HR));
  });

  it("falls back to the season rate when a recent rate is missing or zero", () => {
    const projection = deriveRosProjection({ ERA: 3.0 }, { ERA: 0 }, { recentWeight: 0.5 });

    expect(projection.ERA).toBe(3.0);
  });

  it("clamps out-of-range options instead of producing garbage", () => {
    const projection = deriveRosProjection({ HR: 10 }, null, { remainingFraction: 2, recentWeight: -1 });

    // remainingFraction clamps to 1, recentWeight clamps to 0 -> ROS = season.
    expect(projection.HR).toBe(10);
  });
});

describe("DerivedProjectionsProvider", () => {
  it("projects every supplied context and is attributable to its source", () => {
    const provider = new DerivedProjectionsProvider({ remainingFraction: 0.5, recentWeight: 0 });
    const result = provider.project([
      { playerId: "a", fullName: "A", season: { HR: 20 }, recent: null },
      { playerId: "b", fullName: "B", season: { HR: 8 }, recent: null },
    ]);

    expect(provider.source).toBe("ofb-derived-model");
    expect(result).toEqual([
      { playerId: "a", stats: { HR: 10 } },
      { playerId: "b", stats: { HR: 4 } },
    ]);
  });
});
