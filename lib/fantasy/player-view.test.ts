import { describe, expect, it } from "vitest";
import type { Player } from "./types";
import { formatGameLine, playerOverviewSummary, playerStatusLabel, seasonStatLine } from "./player-view";

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "player-1",
    name: "Test Player",
    mlbTeam: "SEA",
    positions: ["OF"],
    status: "active",
    availability: "free-agent",
    seasonStats: {},
    projectedStats: {},
    ...overrides,
  };
}

describe("seasonStatLine", () => {
  it("shows hitter stats in a stable, useful order", () => {
    expect(seasonStatLine(player({ seasonStats: { R: 40, RBI: 35, HR: 12, AVG: ".275", SB: 8 } }))).toBe(
      ".275 AVG · 12 HR · 40 R · 35 RBI · 8 SB",
    );
  });

  it("uses pitcher categories for pitchers", () => {
    expect(
      seasonStatLine(player({ positions: ["SP", "P"], seasonStats: { K: 90, W: 7, ERA: "3.10", WHIP: "1.08" } })),
    ).toBe("3.10 ERA · 1.08 WHIP · 7 W · 90 K");
  });

  it("returns null when season stats are unavailable", () => {
    expect(seasonStatLine(player())).toBeNull();
  });
});

describe("playerOverviewSummary", () => {
  it("uses recent hitting stats when a position player also has incidental pitching stats", () => {
    const flores = player({
      name: "Rafael Flores Jr.",
      positions: ["1B", "C"],
      seasonStats: { AVG: ".270", HR: 10, RBI: 42, ERA: "0.00", WHIP: "2.00", W: 0, SV: 0, K: 0 },
    });

    expect(
      playerOverviewSummary({
        ...flores,
        statWindows: [
          { split: "last_7", label: "Last 7", stats: { AVG: ".143", OBP: ".217", SLG: ".333", HR: 1, RBI: 4 } },
        ],
      }),
    ).toBe("Flores is hitting .143/.217/.333 with one home run and four RBI over the last seven days.");
  });

  it("falls back to a hitter's season line when recent stats are unavailable", () => {
    expect(
      playerOverviewSummary({
        ...player({ name: "Cal Raleigh", seasonStats: { AVG: ".251", HR: 41, RBI: 88 } }),
        statWindows: [],
      }),
    ).toBe("Raleigh is hitting .251 with 41 home runs and 88 RBI this season.");
  });

  it("keeps a pitcher summary for pitcher-only eligibility", () => {
    expect(
      playerOverviewSummary({
        ...player({ name: "Logan Webb", positions: ["SP"], seasonStats: { ERA: "3.10", WHIP: "1.08", W: 11, K: 144 } }),
        statWindows: [],
      }),
    ).toBe("Logan Webb has a 3.10 ERA and a 1.08 WHIP with 11 wins, 144 strikeouts this season.");
  });
});

describe("player status labels", () => {
  it("shows a specific IL designation even when the player's team has a scheduled game", () => {
    const injured = player({ status: "injured", statusDetail: "60-Day IL" });
    const nextGame = { date: "2026-08-15T23:05:00.000Z", opponent: "CHC", homeAway: "home" as const, venue: null };

    expect(playerStatusLabel(injured)).toBe("60-Day IL");
    expect(formatGameLine(nextGame, injured.status, injured.statusDetail)).toBe("60-Day IL");
  });

  it("formats an explicit server hydration time zone deterministically", () => {
    const nextGame = { date: "2026-08-15T02:10:00.000Z", opponent: "LAD", homeAway: "away" as const, venue: null };

    expect(formatGameLine(nextGame, "active", null, "UTC")).toBe("Sat 2:10 AM @ LAD");
  });

  it("shows No Game when an active player's team is off today", () => {
    const nextGame = { date: "2026-08-16T18:20:00.000Z", opponent: "CHC", homeAway: "away" as const, venue: null };

    expect(formatGameLine(nextGame, "active", null, "UTC", null)).toBe("No Game");
  });
});
