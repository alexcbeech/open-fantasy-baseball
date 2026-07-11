import { describe, expect, it } from "vitest";
import type { LineupPlayer, Player, RosterSlot } from "@/lib/fantasy/types";
import { computeBotLineupUpdate } from "./bot-lineups";

type PlayerOverrides = Partial<Player> & { id: string; positions: RosterSlot[] };

const gameStart = "2026-07-09T23:05:00.000Z";
const beforeGames = new Date("2026-07-09T14:00:00.000Z");
const afterFirstPitch = new Date("2026-07-09T23:30:00.000Z");

function entry(slot: RosterSlot, overrides: PlayerOverrides): LineupPlayer {
  return {
    slot,
    matchupTotal: 0,
    player: {
      name: overrides.id,
      mlbTeam: "NYY",
      status: "active",
      availability: "rostered",
      seasonStats: {},
      projectedStats: {},
      todaysGameStart: gameStart,
      ...overrides,
    },
  };
}

describe("computeBotLineupUpdate", () => {
  it("starts a benched player with a game over a starter without one", () => {
    // Both UTIL seats are held by playing hitters, so the idle catcher has
    // nowhere to slide: the playing catcher takes C and the idle one is benched.
    const lineup = [
      entry("C", { id: "idle-c", positions: ["C"], todaysGameStart: null }),
      entry("BN", { id: "playing-c", positions: ["C"] }),
      entry("UTIL", { id: "util-1", positions: ["UTIL"], projectedStats: { HR: 50 } }),
      entry("UTIL", { id: "util-2", positions: ["UTIL"], projectedStats: { HR: 50 } }),
    ];

    const update = computeBotLineupUpdate(lineup, "daily", beforeGames);
    expect(update.kind).toBe("update");
    if (update.kind === "update") {
      const bySlot = Object.fromEntries(update.entries.map((e) => [e.playerId, e.slot]));
      expect(bySlot["playing-c"]).toBe("C");
      expect(bySlot["idle-c"]).toBe("BN");
      // Unchanged players are not resubmitted.
      expect(update.entries).toHaveLength(2);
    }
  });

  it("returns unchanged when the lineup is already optimal or empty", () => {
    const lineup = [entry("OF", { id: "playing-of", positions: ["OF"] })];
    expect(computeBotLineupUpdate(lineup, "daily", beforeGames).kind).toBe("unchanged");
    expect(computeBotLineupUpdate([], "daily", beforeGames).kind).toBe("unchanged");
  });

  it("reports the whole lineup locked in first-game mode after first pitch", () => {
    const lineup = [
      entry("OF", { id: "idle-of", positions: ["OF"], todaysGameStart: null }),
      entry("BN", { id: "playing-of", positions: ["OF"] }),
    ];

    expect(computeBotLineupUpdate(lineup, "first-game", afterFirstPitch).kind).toBe("locked");
    expect(computeBotLineupUpdate(lineup, "first-game", beforeGames).kind).toBe("update");
  });

  it("keeps per-player game-locked starters in place in daily mode", () => {
    // The started player's game is underway; the idle starter has none, so
    // only the unlocked pair may swap.
    const lineup = [
      entry("OF", { id: "locked-of", positions: ["OF"] }),
      entry("BN", { id: "late-of", positions: ["OF"], todaysGameStart: "2026-07-10T02:00:00.000Z" }),
      entry("C", { id: "idle-c", positions: ["C"], todaysGameStart: null }),
      entry("BN", { id: "playing-c", positions: ["C"], todaysGameStart: "2026-07-10T02:00:00.000Z" }),
    ];

    const update = computeBotLineupUpdate(lineup, "daily", afterFirstPitch);
    expect(update.kind).toBe("update");
    if (update.kind === "update") {
      const ids = update.entries.map((e) => e.playerId);
      expect(ids).not.toContain("locked-of");
      expect(ids).toContain("playing-c");
      expect(ids).toContain("idle-c");
    }
  });
});
