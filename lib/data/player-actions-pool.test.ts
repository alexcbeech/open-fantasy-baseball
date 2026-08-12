import { beforeEach, describe, expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({
  client: { query: vi.fn(), release: vi.fn() },
}));

vi.mock("@/lib/db/client", () => ({
  getPool: () => ({ connect: async () => client }),
  isUniqueViolation: () => false,
}));

vi.mock("@/lib/data/players", () => ({ getPlayerDetail: vi.fn() }));
vi.mock("@/lib/data/game-locks", () => ({
  hasActiveScoringPeriod: vi.fn(),
  hasStartedGameToday: vi.fn(),
  lineupHasStartedGameToday: vi.fn(),
}));

import { applyPlayerManagementAction } from "./player-actions";

beforeEach(() => {
  client.query.mockReset();
  client.release.mockReset();
});

describe("player acquisition pool enforcement", () => {
  it("rejects an out-of-pool add before writing a roster entry", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from fantasy_team ft")) {
        return { rows: [{ league_id: "league-1", settings: { playerPool: "nl-central" } }] };
      }
      if (sql.includes("from player p")) {
        return { rows: [{ status: "active", league: "American League", division: "American League East" }] };
      }
      return { rows: [] };
    });

    await expect(applyPlayerManagementAction("team-1", "player-1", "add")).rejects.toMatchObject({ status: 422 });

    const sqlCalls = client.query.mock.calls.map(([sql]) => sql as string);
    expect(sqlCalls.some((sql) => sql.includes("insert into roster_entry"))).toBe(false);
    expect(sqlCalls).toContain("rollback");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("rejects free-agent adds while the league is pre-draft", async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("from fantasy_team ft")) {
        return {
          rows: [{ league_id: "league-1", league_status: "pre_draft", settings: { playerPool: "nl-central" } }],
        };
      }
      if (sql.includes("from player p")) {
        return { rows: [{ status: "active", league: "National League", division: "National League Central" }] };
      }
      return { rows: [] };
    });

    await expect(applyPlayerManagementAction("team-1", "player-1", "add")).rejects.toMatchObject({
      status: 409,
      message: "The league draft is not complete. Players must be acquired through the draft.",
    });

    expect(client.query.mock.calls.map(([sql]) => sql as string).some((sql) => sql.includes("insert into roster_entry"))).toBe(false);
  });
});
