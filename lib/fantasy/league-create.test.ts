import { describe, expect, it } from "vitest";
import { buildLeagueSettingsFromInput, createLeagueInputSchema, defaultCreateLeagueInput } from "./league-create";
import { defaultRosterSlots } from "./defaults";

function parse(overrides: Record<string, unknown> = {}) {
  return createLeagueInputSchema.parse({ ...defaultCreateLeagueInput, ...overrides });
}

describe("createLeagueInputSchema", () => {
  it("accepts the defaults", () => {
    expect(() => parse()).not.toThrow();
  });

  it("accepts a division-limited player pool", () => {
    expect(parse({ playerPool: "nl-central" }).playerPool).toBe("nl-central");
  });

  it("rejects more playoff teams than teams", () => {
    const result = createLeagueInputSchema.safeParse({ ...defaultCreateLeagueInput, teamCount: 8, playoffTeamCount: 10 });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.message)).toContain(
      "Playoff teams cannot exceed the number of teams.",
    );
  });

  it("bounds bench and IL slots", () => {
    expect(createLeagueInputSchema.safeParse({ ...defaultCreateLeagueInput, benchSlots: 11 }).success).toBe(false);
    expect(createLeagueInputSchema.safeParse({ ...defaultCreateLeagueInput, ilSlots: -1 }).success).toBe(false);
  });
});

describe("buildLeagueSettingsFromInput", () => {
  it("threads bench, IL, and playoff-team settings through to the roster slots", () => {
    const settings = buildLeagueSettingsFromInput(parse({ benchSlots: 3, ilSlots: 2, playoffTeamCount: 4 }));
    expect(settings.rosterSlots.BN).toBe(3);
    expect(settings.rosterSlots.IL).toBe(2);
    // Active slots are untouched by the bench/IL overrides.
    expect(settings.rosterSlots.C).toBe(defaultRosterSlots.C);
    expect(settings.playoffTeamCount).toBe(4);
  });

  it("carries the selected player pool into settings", () => {
    expect(buildLeagueSettingsFromInput(parse({ playerPool: "al-west" })).playerPool).toBe("al-west");
  });
});
