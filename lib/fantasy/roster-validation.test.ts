import { describe, expect, it } from "vitest";
import { players } from "./mock-data";
import { findLineupLockIssues, isPlayerGameLocked, isSlotEligibleForPlayer, validateLineup } from "./roster-validation";
import type { LineupPlayer } from "./types";

describe("lineup validation", () => {
  it("accepts a legal lineup", () => {
    const lineup: LineupPlayer[] = [
      { slot: "C", player: players[5], matchupTotal: 0 },
      { slot: "1B", player: players[6], matchupTotal: 0 },
      { slot: "OF", player: players[0], matchupTotal: 0 },
      { slot: "SP", player: players[7], matchupTotal: 0 },
      { slot: "IL", player: players[2], matchupTotal: 0 },
    ];

    expect(validateLineup(lineup).valid).toBe(true);
  });

  it("rejects duplicate players and position-ineligible slots", () => {
    const lineup: LineupPlayer[] = [
      { slot: "C", player: players[0], matchupTotal: 0 },
      { slot: "OF", player: players[0], matchupTotal: 0 },
    ];

    const validation = validateLineup(lineup);

    expect(validation.valid).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("duplicate-player");
    expect(validation.issues.map((issue) => issue.code)).toContain("position-ineligible");
  });
});

describe("isSlotEligibleForPlayer", () => {
  it("limits an active catcher to catcher, UTIL, and bench", () => {
    const catcher = { positions: ["C"] as const, status: "active" as const };

    expect(isSlotEligibleForPlayer(catcher, "C")).toBe(true);
    expect(isSlotEligibleForPlayer(catcher, "UTIL")).toBe(true);
    expect(isSlotEligibleForPlayer(catcher, "BN")).toBe(true);

    expect(isSlotEligibleForPlayer(catcher, "1B")).toBe(false);
    expect(isSlotEligibleForPlayer(catcher, "SS")).toBe(false);
    expect(isSlotEligibleForPlayer(catcher, "OF")).toBe(false);
    expect(isSlotEligibleForPlayer(catcher, "SP")).toBe(false);
    expect(isSlotEligibleForPlayer(catcher, "P")).toBe(false);
    // Active player cannot be stashed on IL or NA.
    expect(isSlotEligibleForPlayer(catcher, "IL")).toBe(false);
    expect(isSlotEligibleForPlayer(catcher, "NA")).toBe(false);
  });

  it("treats UTIL as hitter-only and P as pitcher-only", () => {
    const pitcher = { positions: ["SP", "P"] as const, status: "active" as const };

    expect(isSlotEligibleForPlayer(pitcher, "P")).toBe(true);
    expect(isSlotEligibleForPlayer(pitcher, "SP")).toBe(true);
    expect(isSlotEligibleForPlayer(pitcher, "RP")).toBe(false);
    expect(isSlotEligibleForPlayer(pitcher, "UTIL")).toBe(false);
  });

  it("honors multi-position eligibility", () => {
    const middleInfielder = { positions: ["SS", "3B"] as const, status: "active" as const };

    expect(isSlotEligibleForPlayer(middleInfielder, "SS")).toBe(true);
    expect(isSlotEligibleForPlayer(middleInfielder, "3B")).toBe(true);
    expect(isSlotEligibleForPlayer(middleInfielder, "2B")).toBe(false);
    expect(isSlotEligibleForPlayer(middleInfielder, "UTIL")).toBe(true);
  });

  it("gates IL on injury status and NA on minor-league status", () => {
    expect(isSlotEligibleForPlayer({ positions: ["OF"], status: "injured" }, "IL")).toBe(true);
    expect(isSlotEligibleForPlayer({ positions: ["OF"], status: "day-to-day" }, "IL")).toBe(true);
    expect(isSlotEligibleForPlayer({ positions: ["OF"], status: "active" }, "IL")).toBe(false);
    expect(isSlotEligibleForPlayer({ positions: ["OF"], status: "minors" }, "NA")).toBe(true);
    expect(isSlotEligibleForPlayer({ positions: ["OF"], status: "active" }, "NA")).toBe(false);
  });

  it("matches the mock catcher's eligibility", () => {
    const rutschman = players[5];
    expect(rutschman.name).toBe("Adley Rutschman");
    expect(isSlotEligibleForPlayer(rutschman, "C")).toBe(true);
    expect(isSlotEligibleForPlayer(rutschman, "1B")).toBe(false);
  });
});

describe("game-start lineup locks", () => {
  const now = new Date("2026-07-05T23:30:00Z");
  const beforeFirstPitch = "2026-07-06T00:10:00Z";
  const afterFirstPitch = "2026-07-05T22:05:00Z";

  it("locks a player once today's first pitch has passed", () => {
    expect(isPlayerGameLocked({ todaysGameStart: afterFirstPitch }, now)).toBe(true);
    expect(isPlayerGameLocked({ todaysGameStart: beforeFirstPitch }, now)).toBe(false);
    expect(isPlayerGameLocked({ todaysGameStart: null }, now)).toBe(false);
    expect(isPlayerGameLocked({}, now)).toBe(false);
  });

  it("rejects slot changes for locked players and allows everyone else", () => {
    const lockedPlayer = { ...players[0], todaysGameStart: afterFirstPitch };
    const freePlayer = { ...players[1], todaysGameStart: beforeFirstPitch };
    const current: LineupPlayer[] = [
      { slot: "OF", player: lockedPlayer, matchupTotal: 0 },
      { slot: "BN", player: freePlayer, matchupTotal: 0 },
    ];

    // Benching the locked player is rejected; promoting the unlocked one is fine.
    const proposed: LineupPlayer[] = [
      { slot: "BN", player: lockedPlayer, matchupTotal: 0 },
      { slot: "OF", player: freePlayer, matchupTotal: 0 },
    ];

    const issues = findLineupLockIssues(current, proposed, now);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("player-locked");
    expect(issues[0].playerId).toBe(lockedPlayer.id);
  });

  it("does not flag a locked player who keeps their slot", () => {
    const lockedPlayer = { ...players[0], todaysGameStart: afterFirstPitch };
    const lineup: LineupPlayer[] = [{ slot: "OF", player: lockedPlayer, matchupTotal: 0 }];

    expect(findLineupLockIssues(lineup, lineup, now)).toHaveLength(0);
  });
});
