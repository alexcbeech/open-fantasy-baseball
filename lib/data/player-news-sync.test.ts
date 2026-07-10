import { describe, expect, it } from "vitest";
import { StatusAndScheduleNewsProvider, deriveNewsDrafts } from "./player-news-sync";

const now = new Date("2026-07-02T12:00:00.000Z");

function context(overrides: Partial<Parameters<typeof deriveNewsDrafts>[0]> = {}) {
  return {
    playerId: "p1",
    fullName: "Julio Rodriguez",
    status: "active",
    teamAbbrev: "SEA",
    probableStart: null,
    ...overrides,
  };
}

describe("deriveNewsDrafts", () => {
  it("produces no news for an active player with nothing scheduled", () => {
    expect(deriveNewsDrafts(context(), now)).toEqual([]);
  });

  it("creates an injury item stamped at the start of the sync day", () => {
    const [item] = deriveNewsDrafts(context({ status: "injured" }), now);

    expect(item.headline).toBe("Julio Rodriguez placed on the injured list");
    // Day-stable so re-syncs dedupe (and managers get at most one push a day).
    expect(item.publishedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(item.injuryStatus).toBe("injured");
  });

  it("creates a day-to-day item", () => {
    const [item] = deriveNewsDrafts(context({ status: "day-to-day" }), now);
    expect(item.headline).toBe("Julio Rodriguez listed as day-to-day");
  });

  it("creates a probable-start item dated to the game with the opponent", () => {
    const [item] = deriveNewsDrafts(
      context({ fullName: "Tarik Skubal", teamAbbrev: "DET", probableStart: { gameDate: "2026-07-05", opponentAbbrev: "CLE" } }),
      now,
    );

    expect(item.headline).toBe("Tarik Skubal probable to start vs CLE on 2026-07-05");
    expect(item.publishedAt).toBe("2026-07-05T00:00:00.000Z");
  });

  it("omits the opponent when it is unknown", () => {
    const [item] = deriveNewsDrafts(context({ probableStart: { gameDate: "2026-07-05", opponentAbbrev: null } }), now);
    expect(item.headline).toBe("Julio Rodriguez probable to start on 2026-07-05");
  });

  it("emits both a status item and a probable-start item when both apply", () => {
    const drafts = deriveNewsDrafts(
      context({ status: "day-to-day", probableStart: { gameDate: "2026-07-05", opponentAbbrev: "CLE" } }),
      now,
    );
    expect(drafts).toHaveLength(2);
  });
});

describe("StatusAndScheduleNewsProvider", () => {
  it("flattens drafts across contexts and is attributable", () => {
    const provider = new StatusAndScheduleNewsProvider();
    const drafts = provider.generate([context({ status: "injured" }), context({ playerId: "p2", status: "minors" })], now);

    expect(provider.source).toBe("ofb-signals");
    expect(drafts).toHaveLength(2);
  });
});
