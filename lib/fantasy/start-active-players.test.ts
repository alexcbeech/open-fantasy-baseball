import { describe, expect, it } from "vitest";
import { defaultRosterSlots } from "./defaults";
import type { LineupPlayer, Player, RosterSlot } from "./types";
import { validateLineup } from "./roster-validation";
import { planActiveLineup, startsToday } from "./start-active-players";

// A tight roster shape (single OF, no UTIL) so tests can create real
// contention for starting slots; the default 3 OF + 2 UTIL seats everyone.
const tightSlots: Record<RosterSlot, number> = { ...defaultRosterSlots, OF: 1, UTIL: 0 };

type PlayerOverrides = Partial<Player> & { id: string; positions: RosterSlot[] };

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
      todaysGameStart: "2026-07-09T23:05:00.000Z",
      ...overrides,
    },
  };
}

// projectedStats producing simple point totals: HR is worth 4 points.
function proj(points: number): Record<string, number> {
  return { HR: points / 4 };
}

describe("startsToday", () => {
  it("counts hitters and relievers whenever their team plays today", () => {
    expect(startsToday(entry("BN", { id: "of", positions: ["OF"] }).player)).toBe(true);
    expect(startsToday(entry("BN", { id: "rp", positions: ["RP"] }).player)).toBe(true);
    // Bat-only DH types carry the "UTIL" position and are everyday hitters.
    expect(startsToday(entry("BN", { id: "dh", positions: ["UTIL"] }).player)).toBe(true);
  });

  it("requires SP-only pitchers to be the probable starter", () => {
    expect(startsToday(entry("BN", { id: "sp", positions: ["SP"] }).player)).toBe(false);
    expect(startsToday(entry("BN", { id: "sp", positions: ["SP"], probableStarterToday: true }).player)).toBe(true);
  });

  it("excludes players with no game today and unavailable players", () => {
    expect(startsToday(entry("BN", { id: "off", positions: ["OF"], todaysGameStart: null }).player)).toBe(false);
    expect(startsToday(entry("BN", { id: "hurt", positions: ["OF"], status: "injured" }).player)).toBe(false);
    expect(startsToday(entry("BN", { id: "kid", positions: ["OF"], status: "minors" }).player)).toBe(false);
  });
});

describe("planActiveLineup", () => {
  it("starts a benched player with a game today over a starter with no game", () => {
    const lineup = [
      entry("OF", { id: "idle-of", positions: ["OF"], todaysGameStart: null }),
      entry("BN", { id: "playing-of", positions: ["OF"] }),
    ];

    const next = planActiveLineup(lineup, new Set(), tightSlots);
    expect(next["playing-of"]).toBe("OF");
    expect(next["idle-of"]).toBe("BN");
  });

  it("breaks ties by projected points, then ADP", () => {
    const lineup = [
      entry("BN", { id: "low-proj", positions: ["C"], projectedStats: proj(100) }),
      entry("BN", { id: "high-proj", positions: ["C"], projectedStats: proj(200) }),
      entry("BN", { id: "late-adp", positions: ["SS"], adp: 180 }),
      entry("BN", { id: "early-adp", positions: ["SS"], adp: 12 }),
    ];

    const next = planActiveLineup(lineup, new Set(), tightSlots);
    expect(next["high-proj"]).toBe("C");
    expect(next["low-proj"]).toBe("BN");
    expect(next["early-adp"]).toBe("SS");
    expect(next["late-adp"]).toBe("BN");
  });

  it("reseats a flexible player so a constrained one can start", () => {
    // The two-position player is placed first (higher projection) and takes
    // 1B; the pure first baseman must displace them into the open C slot.
    const lineup = [
      entry("BN", { id: "flex", positions: ["C", "1B"], projectedStats: proj(400) }),
      entry("BN", { id: "pure-1b", positions: ["1B"], projectedStats: proj(100) }),
    ];

    const next = planActiveLineup(lineup, new Set());
    expect(next.flex).toBe("C");
    expect(next["pure-1b"]).toBe("1B");
  });

  it("keeps locked players in place and fills around them", () => {
    const lineup = [
      entry("C", { id: "locked-c", positions: ["C"], todaysGameStart: null }),
      entry("BN", { id: "better-c", positions: ["C"], projectedStats: proj(400) }),
    ];

    const next = planActiveLineup(lineup, new Set(["locked-c"]));
    // The locked catcher keeps the only C slot; the better catcher can still
    // start at UTIL.
    expect(next["locked-c"]).toBe("C");
    expect(next["better-c"]).toBe("UTIL");
  });

  it("leaves IL and NA players untouched", () => {
    const lineup = [
      entry("IL", { id: "hurt", positions: ["OF"], status: "injured" }),
      entry("NA", { id: "kid", positions: ["OF"], status: "minors" }),
      entry("BN", { id: "of", positions: ["OF"] }),
    ];

    const next = planActiveLineup(lineup, new Set());
    expect(next.hurt).toBe("IL");
    expect(next.kid).toBe("NA");
    expect(next.of).toBe("OF");
  });

  it("seats a bat-only DH in the UTIL slot", () => {
    const lineup = [
      entry("BN", { id: "dh", positions: ["UTIL"], projectedStats: proj(400) }),
      entry("BN", { id: "of", positions: ["OF"], projectedStats: proj(100) }),
    ];

    const next = planActiveLineup(lineup, new Set());
    expect(next.dh).toBe("UTIL");
    expect(next.of).toBe("OF");
  });

  it("prefers today's probable starter for the SP slot", () => {
    const lineup = [
      entry("SP", { id: "idle-sp", positions: ["SP"], projectedStats: proj(400) }),
      entry("SP", { id: "idle-sp-2", positions: ["SP"], projectedStats: proj(400) }),
      entry("BN", { id: "probable", positions: ["SP"], probableStarterToday: true, projectedStats: proj(100) }),
    ];

    const next = planActiveLineup(lineup, new Set());
    expect(next.probable).toBe("SP");
  });

  it("returns a slot for every player and a lineup that validates", () => {
    const lineup = [
      entry("C", { id: "c1", positions: ["C"] }),
      entry("BN", { id: "c2", positions: ["C"] }),
      entry("BN", { id: "if1", positions: ["1B", "3B"] }),
      entry("BN", { id: "mi1", positions: ["2B", "SS"] }),
      entry("BN", { id: "of1", positions: ["OF"] }),
      entry("BN", { id: "of2", positions: ["OF"] }),
      entry("BN", { id: "of3", positions: ["OF"] }),
      entry("BN", { id: "of4", positions: ["OF"] }),
      entry("BN", { id: "sp1", positions: ["SP"], probableStarterToday: true }),
      entry("BN", { id: "rp1", positions: ["RP"] }),
      entry("BN", { id: "rp2", positions: ["RP"] }),
    ];

    const next = planActiveLineup(lineup, new Set());
    expect(Object.keys(next)).toHaveLength(lineup.length);

    const proposed = lineup.map((item) => ({ ...item, slot: next[item.player.id] }));
    expect(validateLineup(proposed).valid).toBe(true);
  });
});
