import { describe, expect, it } from "vitest";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import type { RosterSlot } from "@/lib/fantasy/types";
import { planInitialLineup, type AssignablePlayer } from "./lineup-assignment";

function player(playerId: string, positions: RosterSlot[], status: AssignablePlayer["status"] = "active"): AssignablePlayer {
  return { playerId, positions, status };
}

describe("planInitialLineup", () => {
  it("fills dedicated slots before flex and bench", () => {
    const assignments = planInitialLineup(
      [player("c1", ["C"]), player("ss1", ["SS"]), player("of1", ["OF"]), player("sp1", ["SP"])],
      defaultRosterSlots,
    );
    const bySlot = Object.fromEntries(assignments.map((a) => [a.playerId, a.slot]));
    expect(bySlot.c1).toBe("C");
    expect(bySlot.ss1).toBe("SS");
    expect(bySlot.of1).toBe("OF");
    expect(bySlot.sp1).toBe("SP");
  });

  it("overflows surplus players to UTIL/P then bench", () => {
    const catchers = [1, 2, 3, 4, 5].map((n) => player(`c${n}`, ["C"]));
    const assignments = planInitialLineup(catchers, defaultRosterSlots);
    const slots = assignments.map((a) => a.slot).sort();
    // 1 C slot, 2 UTIL, rest bench.
    expect(slots).toEqual(["BN", "BN", "C", "UTIL", "UTIL"]);
  });

  it("places constrained players before flexible multi-position players", () => {
    // The 1B/C player can play 1B; the pure catcher can only play C. If the
    // flexible player were placed first at C, the pure catcher would land on
    // the bench even though both could start.
    const assignments = planInitialLineup(
      [player("flex", ["C", "1B"]), player("pure-c", ["C"])],
      defaultRosterSlots,
    );
    const bySlot = Object.fromEntries(assignments.map((a) => [a.playerId, a.slot]));
    expect(bySlot["pure-c"]).toBe("C");
    expect(bySlot.flex).toBe("1B");
  });

  it("assigns every drafted player somewhere", () => {
    const roster: AssignablePlayer[] = [];

    for (let i = 0; i < 23; i++) {
      const positions: RosterSlot[][] = [["C"], ["1B"], ["2B"], ["3B"], ["SS"], ["OF"], ["SP"], ["RP"]];
      roster.push(player(`p${i}`, positions[i % positions.length]));
    }

    const assignments = planInitialLineup(roster, defaultRosterSlots);
    expect(assignments).toHaveLength(23);
    expect(new Set(assignments.map((a) => a.playerId)).size).toBe(23);
  });
});
