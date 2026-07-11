import { describe, expect, it } from "vitest";
import { platoonFactor, projectTodayPoints } from "./daily-projection";
import type { Player, RosterSlot } from "./types";

type PlayerOverrides = Partial<Player> & { id: string; positions: RosterSlot[] };

function player(overrides: PlayerOverrides): Player {
  return {
    name: overrides.id,
    mlbTeam: "NYY",
    status: "active",
    availability: "rostered",
    seasonStats: {},
    // HR is worth 4 points: proj(HR: 73) = 292 ROS points = 4/game over 73 games.
    projectedStats: { HR: 73 },
    todaysGameStart: "2026-07-11T23:05:00.000Z",
    ...overrides,
  };
}

describe("platoonFactor", () => {
  it("penalizes same-hand matchups and rewards the platoon advantage", () => {
    expect(platoonFactor("L", "L")).toBeLessThan(1);
    expect(platoonFactor("R", "R")).toBeLessThan(1);
    expect(platoonFactor("L", "R")).toBeGreaterThan(1);
    expect(platoonFactor("R", "L")).toBeGreaterThan(1);
    // Lefty bats suffer the larger same-side penalty.
    expect(platoonFactor("L", "L")).toBeLessThan(platoonFactor("R", "R"));
  });

  it("gives switch hitters a small edge and unknown hands no adjustment", () => {
    expect(platoonFactor("S", "L")).toBeGreaterThan(1);
    expect(platoonFactor("S", "R")).toBeGreaterThan(1);
    expect(platoonFactor(null, "L")).toBe(1);
    expect(platoonFactor("L", null)).toBe(1);
    expect(platoonFactor("L", "S")).toBe(1);
  });
});

describe("projectTodayPoints", () => {
  it("is zero without a game today or when unavailable", () => {
    expect(projectTodayPoints(player({ id: "off", positions: ["OF"], todaysGameStart: null }))).toBe(0);
    expect(projectTodayPoints(player({ id: "hurt", positions: ["OF"], status: "injured" }))).toBe(0);
  });

  it("gives hitters their per-game ROS slice, platoon-adjusted", () => {
    const neutral = projectTodayPoints(player({ id: "of", positions: ["OF"] }));
    expect(neutral).toBeCloseTo(4, 5);

    const leftyVsLefty = projectTodayPoints(
      player({ id: "lhb", positions: ["OF"], bats: "L", todaysOpposingPitcherThrows: "L" }),
    );
    const leftyVsRighty = projectTodayPoints(
      player({ id: "lhb2", positions: ["OF"], bats: "L", todaysOpposingPitcherThrows: "R" }),
    );
    expect(leftyVsLefty).toBeLessThan(neutral);
    expect(leftyVsRighty).toBeGreaterThan(neutral);
  });

  it("projects a full start for probable starters and zero for idle SPs", () => {
    const probable = projectTodayPoints(player({ id: "sp", positions: ["SP"], probableStarterToday: true }));
    // 292 ROS points over ~14 remaining starts ≈ 20.9 per start.
    expect(probable).toBeCloseTo(292 / 14, 5);
    expect(projectTodayPoints(player({ id: "idle-sp", positions: ["SP"] }))).toBe(0);
  });

  it("spreads a reliever's value across team games, unadjusted by platoon", () => {
    const rp = projectTodayPoints(
      player({ id: "rp", positions: ["RP"], bats: "L", todaysOpposingPitcherThrows: "L" }),
    );
    expect(rp).toBeCloseTo(4, 5);
  });
});
