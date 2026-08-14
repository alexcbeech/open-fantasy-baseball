import { describe, expect, it } from "vitest";
import type { Player } from "./types";
import { formatGameLine, playerStatusLabel, seasonStatLine } from "./player-view";

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
});
