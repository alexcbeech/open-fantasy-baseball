import { describe, expect, it } from "vitest";
import { defaultRosterSlots } from "./defaults";
import type { RosterSlot } from "./types";
import { tradeIssues, votesNeededToReject, type TradeRosterPlayer } from "./trade-evaluation";

let nextId = 0;

function player(positions: RosterSlot[], playerId = `p${nextId++}`): TradeRosterPlayer {
  return { playerId, positions };
}

/** A legal 23-man roster: 15 hitters (batter slots + bench) and 8 pitchers. */
function fullRoster(prefix: string): TradeRosterPlayer[] {
  const hitters: RosterSlot[][] = [
    ["C"], ["1B"], ["2B"], ["3B"], ["SS"], ["OF"], ["OF"], ["OF"],
    ["1B"], ["2B"], ["3B"], ["SS"], ["OF"], ["OF"], ["OF"],
  ];
  const pitchers: RosterSlot[][] = [["SP"], ["SP"], ["RP"], ["RP"], ["SP"], ["SP"], ["RP"], ["RP"]];
  return [...hitters, ...pitchers].map((positions, index) => player(positions, `${prefix}${index}`));
}

function sides(overrides: Partial<Parameters<typeof tradeIssues>[0]>): Parameters<typeof tradeIssues>[0] {
  return {
    fromRoster: fullRoster("a"),
    toRoster: fullRoster("b"),
    offeredPlayerIds: [],
    requestedPlayerIds: [],
    fromDropPlayerIds: [],
    toDropPlayerIds: [],
    ...overrides,
  };
}

describe("tradeIssues", () => {
  it("accepts a balanced one-for-one trade", () => {
    const issues = tradeIssues(sides({ offeredPlayerIds: ["a5"], requestedPlayerIds: ["b5"] }), defaultRosterSlots);
    expect(issues).toEqual([]);
  });

  it("accepts a balanced multi-player trade", () => {
    const issues = tradeIssues(
      sides({ offeredPlayerIds: ["a5", "a15"], requestedPlayerIds: ["b6", "b16"] }),
      defaultRosterSlots,
    );
    expect(issues).toEqual([]);
  });

  it("requires at least one player on each side", () => {
    const issues = tradeIssues(sides({ offeredPlayerIds: ["a5"] }), defaultRosterSlots);
    expect(issues[0]).toContain("at least one player each way");
  });

  it("flags players no longer on the sending roster", () => {
    const issues = tradeIssues(sides({ offeredPlayerIds: ["ghost"], requestedPlayerIds: ["b5"] }), defaultRosterSlots);
    expect(issues[0]).toContain("proposing team no longer has");
  });

  it("rejects a two-for-one that overflows the receiving roster", () => {
    // Full 23-man rosters: receiving 2 while sending 1 makes 24 players.
    const issues = tradeIssues(
      sides({ offeredPlayerIds: ["a5", "a6"], requestedPlayerIds: ["b5"] }),
      defaultRosterSlots,
    );
    expect(issues.some((issue) => issue.includes("receiving team with more players"))).toBe(true);
    expect(issues.some((issue) => issue.includes("proposing team with more players"))).toBe(false);
  });

  it("rejects a one-for-two that overflows the proposing roster", () => {
    const issues = tradeIssues(
      sides({ offeredPlayerIds: ["a5"], requestedPlayerIds: ["b5", "b6"] }),
      defaultRosterSlots,
    );
    expect(issues.some((issue) => issue.includes("proposing team with more players"))).toBe(true);
  });

  it("accepts an unbalanced trade once drops make room", () => {
    const issues = tradeIssues(
      sides({ offeredPlayerIds: ["a5"], requestedPlayerIds: ["b5", "b6"], fromDropPlayerIds: ["a6"] }),
      defaultRosterSlots,
    );
    expect(issues).toEqual([]);
  });

  it("accepts when the receiving side's drops make room", () => {
    const issues = tradeIssues(
      sides({ offeredPlayerIds: ["a5", "a6"], requestedPlayerIds: ["b5"], toDropPlayerIds: ["b6"] }),
      defaultRosterSlots,
    );
    expect(issues).toEqual([]);
  });

  it("rejects dropping a player who is also being traded", () => {
    const issues = tradeIssues(
      sides({ offeredPlayerIds: ["a5"], requestedPlayerIds: ["b5"], fromDropPlayerIds: ["a5"] }),
      defaultRosterSlots,
    );
    expect(issues[0]).toContain("both traded and dropped");
  });

  it("rejects a positionally impossible swap even at equal counts", () => {
    // Sending a pitcher for a hitter when the roster has no hitter room left:
    // 16 hitters can't fit 15 hitter seats.
    const issues = tradeIssues(
      sides({ offeredPlayerIds: ["a20"], requestedPlayerIds: ["b5"] }),
      defaultRosterSlots,
    );
    expect(issues.some((issue) => issue.includes("proposing team with more players"))).toBe(true);
  });
});

describe("votesNeededToReject", () => {
  it("requires a strict majority of teams outside the trade", () => {
    expect(votesNeededToReject(4)).toBe(2); // 2 eligible voters
    expect(votesNeededToReject(10)).toBe(5); // 8 eligible voters
    expect(votesNeededToReject(12)).toBe(6); // 10 eligible voters
  });

  it("never resolves with zero eligible voters", () => {
    expect(votesNeededToReject(2)).toBe(Number.POSITIVE_INFINITY);
  });
});
