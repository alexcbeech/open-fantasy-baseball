import { describe, expect, it } from "vitest";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";
import type { RosterSlot } from "@/lib/fantasy/types";
import { computeRosterNeeds, filterCandidatesWithRoom, selectAutoPick, type DraftCandidate } from "./auto-pick";

function candidate(playerId: string, adpRank: number, positions: RosterSlot[]): DraftCandidate {
  return { playerId, adpRank, positions };
}

describe("computeRosterNeeds", () => {
  it("starts at the league slot counts with no picks", () => {
    const needs = computeRosterNeeds(defaultRosterSlots, []);
    expect(needs.C).toBe(1);
    expect(needs.OF).toBe(3);
    expect(needs.BN).toBe(5);
    expect(needs.IL).toBe(0);
    expect(needs.NA).toBe(0);
  });

  it("consumes dedicated slots before flex and bench", () => {
    const needs = computeRosterNeeds(defaultRosterSlots, [["C"], ["C"], ["C"]]);
    // First catcher fills C, the next two consume UTIL (hitter flex).
    expect(needs.C).toBe(0);
    expect(needs.UTIL).toBe(0);
    expect(needs.BN).toBe(5);
  });

  it("sends pitchers to P flex once SP/RP are full", () => {
    const needs = computeRosterNeeds(defaultRosterSlots, [["SP"], ["SP"], ["SP"], ["SP"]]);
    expect(needs.SP).toBe(0);
    expect(needs.P).toBe(2);
  });
});

describe("selectAutoPick", () => {
  it("takes the best available player when needs are equal", () => {
    const needs = computeRosterNeeds(defaultRosterSlots, []);
    const pick = selectAutoPick(
      [candidate("a", 2, ["OF"]), candidate("b", 1, ["SS"]), candidate("c", 3, ["SP"])],
      needs,
    );
    expect(pick?.playerId).toBe("b");
  });

  it("prefers a needed position over a modestly better surplus player", () => {
    // Catcher slot already filled; SS still open.
    const needs = computeRosterNeeds(defaultRosterSlots, [["C"]]);
    const pick = selectAutoPick(
      [candidate("second-catcher", 10, ["C"]), candidate("shortstop", 18, ["SS"])],
      needs,
    );
    expect(pick?.playerId).toBe("shortstop");
  });

  it("still takes a dominant player even at a surplus position", () => {
    const needs = computeRosterNeeds(defaultRosterSlots, [["C"]]);
    const pick = selectAutoPick(
      [candidate("elite-catcher", 1, ["C"]), candidate("mediocre-ss", 60, ["SS"])],
      needs,
    );
    expect(pick?.playerId).toBe("elite-catcher");
  });

  it("never drafts a third catcher early in a full simulated draft", () => {
    // Simulate one bot drafting 15 rounds from a pool heavy with catchers.
    const pool: DraftCandidate[] = [];

    for (let i = 1; i <= 200; i++) {
      const positions: RosterSlot[][] = [["C"], ["1B"], ["2B"], ["3B"], ["SS"], ["OF"], ["OF"], ["SP"], ["SP"], ["RP"]];
      pool.push(candidate(`p${i}`, i, positions[i % positions.length]));
    }

    const drafted: RosterSlot[][] = [];
    const taken = new Set<string>();
    let catchersByRound15 = 0;

    for (let round = 1; round <= 15; round++) {
      const needs = computeRosterNeeds(defaultRosterSlots, drafted);
      const pick = selectAutoPick(pool.filter((c) => !taken.has(c.playerId)), needs);

      expect(pick).not.toBeNull();
      taken.add(pick!.playerId);
      drafted.push(pick!.positions);

      if (pick!.positions.includes("C")) {
        catchersByRound15 += 1;
      }
    }

    expect(catchersByRound15).toBeLessThanOrEqual(2);
  });

  it("returns null when no candidates remain", () => {
    expect(selectAutoPick([], computeRosterNeeds(defaultRosterSlots, []))).toBeNull();
  });
});

describe("filterCandidatesWithRoom", () => {
  // 15 hitters = every batter slot (C/1B/2B/3B/SS/OF×3/UTIL×2) plus the
  // 5-slot bench. Only pitcher slots remain open.
  const hitterFullRoster: RosterSlot[][] = [
    ["C"], ["1B"], ["2B"], ["3B"], ["SS"], ["OF"], ["OF"], ["OF"],
    ["1B"], ["2B"], ["3B"], ["SS"], ["OF"], ["OF"], ["OF"],
  ];

  it("excludes hitters once only pitcher room remains", () => {
    const filtered = filterCandidatesWithRoom(
      [candidate("hitter", 1, ["OF"]), candidate("pitcher", 50, ["SP"])],
      hitterFullRoster,
      defaultRosterSlots,
    );
    expect(filtered.map((c) => c.playerId)).toEqual(["pitcher"]);
  });

  it("keeps everyone while room remains", () => {
    const filtered = filterCandidatesWithRoom(
      [candidate("hitter", 1, ["OF"]), candidate("pitcher", 50, ["SP"])],
      [["C"], ["SP"]],
      defaultRosterSlots,
    );
    expect(filtered).toHaveLength(2);
  });

  it("falls back to the full list when nothing fits, so the draft never stalls", () => {
    const filtered = filterCandidatesWithRoom(
      [candidate("hitter-a", 1, ["OF"]), candidate("hitter-b", 2, ["C"])],
      hitterFullRoster,
      defaultRosterSlots,
    );
    expect(filtered).toHaveLength(2);
  });

  it("keeps auto-drafts from overfilling the bench across a full draft", () => {
    // A pool that starts hitter-heavy: without the room filter the bot hoards
    // hitters and ends with more than batter slots + bench can hold.
    const pool: DraftCandidate[] = [];
    const hitterPositions: RosterSlot[][] = [["C"], ["1B"], ["2B"], ["3B"], ["SS"], ["OF"]];

    for (let i = 1; i <= 40; i++) {
      pool.push(candidate(`h${i}`, i, hitterPositions[i % hitterPositions.length]));
    }
    for (let i = 41; i <= 80; i++) {
      pool.push(candidate(`p${i}`, i, i % 3 === 0 ? ["RP"] : ["SP"]));
    }

    const drafted: RosterSlot[][] = [];
    const taken = new Set<string>();

    for (let round = 1; round <= 23; round++) {
      const available = pool.filter((c) => !taken.has(c.playerId));
      const withRoom = filterCandidatesWithRoom(available, drafted, defaultRosterSlots);
      const pick = selectAutoPick(withRoom, computeRosterNeeds(defaultRosterSlots, drafted));

      expect(pick).not.toBeNull();
      taken.add(pick!.playerId);
      drafted.push(pick!.positions);
    }

    const pitchers = drafted.filter((positions) => positions.every((p) => ["SP", "RP", "P"].includes(p))).length;
    // 8 pitcher slots (SP 2 + RP 2 + P 4) and 15 hitter seats: a legal 23-man
    // roster needs at least 8 pitchers.
    expect(pitchers).toBeGreaterThanOrEqual(8);
  });
});
