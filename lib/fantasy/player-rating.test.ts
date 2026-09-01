import { describe, expect, it } from "vitest";
import type { PlayerValueMetrics } from "./types";
import { playerRecentForm, playerStarRating } from "./player-rating";

function value(overrides: Partial<PlayerValueMetrics> = {}): PlayerValueMetrics {
  return {
    fanPoints: 100,
    rank: 500,
    totalRanked: 1_000,
    rosteredPercent: 50,
    ratingPosition: "C",
    positionRank: 50,
    positionTotalRanked: 100,
    ...overrides,
  };
}

describe("playerStarRating", () => {
  it("uses best-position rank as the dominant signal", () => {
    const rating = playerStarRating(value());

    expect(rating).toMatchObject({ stars: 3, rank: 50, totalRanked: 100, position: "C" });
    expect(rating?.score).toBeCloseTo(0.5085);
  });

  it("allows roster rate to nudge rather than dictate the rating", () => {
    const lightlyRostered = playerStarRating(value({ rosteredPercent: 5 }));
    const widelyRostered = playerStarRating(value({ rosteredPercent: 95 }));

    expect(lightlyRostered?.score).toBeCloseTo(0.441);
    expect(widelyRostered?.score).toBeCloseTo(0.576);
    expect(lightlyRostered?.rank).toBe(widelyRostered?.rank);
  });

  it("raises the rating for a player producing well above their season pace", () => {
    const baseline = playerStarRating(value());
    const hot = playerStarRating(value(), 1);

    expect(baseline?.stars).toBe(3);
    expect(hot?.stars).toBe(4);
    expect(hot?.score).toBeGreaterThan(baseline?.score ?? 0);
  });

  it("falls back to overall rank when positional rank is unavailable", () => {
    expect(
      playerStarRating(value({
        rank: 100,
        totalRanked: 1_000,
        ratingPosition: null,
        positionRank: null,
        positionTotalRanked: 0,
        rosteredPercent: null,
      })),
    ).toMatchObject({ stars: 5, rank: 100, totalRanked: 1_000, position: null });
  });

  it("returns no rating without any ranked production", () => {
    expect(
      playerStarRating(value({
        rank: null,
        totalRanked: 0,
        positionRank: null,
        positionTotalRanked: 0,
      })),
    ).toBeNull();
  });
});

describe("playerRecentForm", () => {
  it("recognizes a hot hitter by points per plate appearance", () => {
    const form = playerRecentForm({
      positions: ["1B", "C"],
      seasonStats: { AB: 400, H: 100, "2B": 20, HR: 10, R: 50, RBI: 50, BB: 30, HBP: 5 },
      statWindows: [
        {
          split: "last_7",
          label: "Last 7",
          stats: { AB: 20, H: 10, "2B": 1, HR: 3, R: 5, RBI: 8, BB: 4, HBP: 0 },
        },
      ],
    });

    expect(form).toBe(1);
  });

  it("ignores a hitter window with too few plate appearances", () => {
    expect(
      playerRecentForm({
        positions: ["OF"],
        seasonStats: { AB: 400, H: 100 },
        statWindows: [{ split: "last_7", label: "Last 7", stats: { AB: 5, H: 4 } }],
      }),
    ).toBeNull();
  });

  it("recognizes a hot pitcher by points per inning", () => {
    const form = playerRecentForm({
      positions: ["SP"],
      seasonStats: { IP: 100, O: 300, W: 8, K: 100, ER: 40, P_BB: 30, P_H: 90 },
      statWindows: [
        { split: "last_7", label: "Last 7", stats: { IP: 7, O: 21, W: 1, K: 12, ER: 0, P_BB: 1, P_H: 3 } },
      ],
    });

    expect(form).not.toBeNull();
    expect(form ?? 0).toBeGreaterThan(0.5);
  });
});
