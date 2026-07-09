import { describe, expect, it } from "vitest";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import type { RosterSlot } from "@/lib/fantasy/types";
import { planInitialLineup, rosterFits, type AssignablePlayer } from "./lineup-assignment";

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

  it("relocates a seated player when that is the only way to seat a late one", () => {
    // Everyone is eligible for exactly two slots, so ordering can't help. The
    // early players take C and 1B greedily; the last player fits only if the
    // C occupant is displaced to their open SS slot.
    const tightSlots: Record<RosterSlot, number> = {
      ...defaultRosterSlots,
      C: 1, "1B": 1, SS: 1, OF: 1,
      "2B": 0, "3B": 0, UTIL: 0, SP: 0, RP: 0, P: 0, BN: 0, IL: 0, NA: 0,
    };
    const assignments = planInitialLineup(
      [player("q", ["C", "SS"]), player("r", ["1B", "OF"]), player("p", ["C", "1B"])],
      tightSlots,
    );
    const bySlot = Object.fromEntries(assignments.map((a) => [a.playerId, a.slot]));
    expect(new Set(Object.values(bySlot)).size).toBe(3);
    expect(["C", "1B"]).toContain(bySlot.p);
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

describe("rosterFits", () => {
  // Every batter slot (C/1B/2B/3B/SS/OF×3/UTIL×2) plus the 5-slot bench.
  const fifteenHitters: RosterSlot[][] = [
    ["C"], ["1B"], ["2B"], ["3B"], ["SS"], ["OF"], ["OF"], ["OF"],
    ["1B"], ["2B"], ["3B"], ["SS"], ["OF"], ["OF"], ["OF"],
  ];

  it("accepts a roster shape that seats everyone", () => {
    expect(rosterFits([...fifteenHitters, ["SP"], ["SP"], ["RP"], ["RP"], ["SP"], ["SP"], ["RP"], ["RP"]], defaultRosterSlots)).toBe(true);
  });

  it("rejects a 16th hitter once batter slots and bench are committed", () => {
    expect(rosterFits([...fifteenHitters, ["OF"]], defaultRosterSlots)).toBe(false);
  });

  it("still accepts a pitcher when only pitcher slots remain", () => {
    expect(rosterFits([...fifteenHitters, ["SP"]], defaultRosterSlots)).toBe(true);
  });

  it("uses matching, not first-fit, to decide fit", () => {
    // The C/SS and 1B/OF players must spread out so the C/1B player fits.
    const tightSlots: Record<RosterSlot, number> = {
      ...defaultRosterSlots,
      C: 1, "1B": 1, SS: 1, OF: 1,
      "2B": 0, "3B": 0, UTIL: 0, SP: 0, RP: 0, P: 0, BN: 0, IL: 0, NA: 0,
    };
    expect(rosterFits([["C", "SS"], ["1B", "OF"], ["C", "1B"]], tightSlots)).toBe(true);
    // Three players sharing the same two seats can never all fit.
    expect(rosterFits([["C", "1B"], ["C", "1B"], ["C", "1B"]], tightSlots)).toBe(false);
  });
});
