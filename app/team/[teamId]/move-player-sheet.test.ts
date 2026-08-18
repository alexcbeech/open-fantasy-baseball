import { describe, expect, it } from "vitest";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import type { LineupPlayer, RosterSlot } from "@/lib/fantasy/types";
import { buildMoveOptions } from "./move-player-sheet";

function entry(id: string, slot: RosterSlot, positions: RosterSlot[]): LineupPlayer {
  return {
    slot,
    matchupTotal: 0,
    player: {
      id,
      name: id,
      mlbTeam: "STL",
      positions,
      status: "active",
      availability: "rostered",
      seasonStats: {},
      projectedStats: {},
    },
  };
}

describe("buildMoveOptions", () => {
  it("offers a direct swap with a bench player even when the bench has an open seat", () => {
    const starter = entry("starter", "C", ["C"]);
    const bench = entry("bench", "BN", ["C"]);
    const options = buildMoveOptions(starter, [starter, bench], defaultRosterSlots);

    expect(options).toContainEqual({ kind: "open", slot: "BN" });
    expect(options).toContainEqual({ kind: "swap", slot: "BN", occupant: bench });
  });

  it("does not offer a locked bench occupant as a swap", () => {
    const starter = entry("starter", "C", ["C"]);
    const bench = entry("bench", "BN", ["C"]);
    const options = buildMoveOptions(starter, [starter, bench], defaultRosterSlots, new Set(["bench"]));

    expect(options.some((option) => option.kind === "swap" && option.occupant.player.id === "bench")).toBe(false);
  });
});
