import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbQuery } = vi.hoisted(() => ({ dbQuery: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  isUuid: (value: string) => /^[0-9a-f-]{36}$/i.test(value),
  query: dbQuery,
  withDemoFallback: async <T>(operation: () => Promise<T>) => operation(),
}));

import { listPlayers } from "./players";

const LEAGUE_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  dbQuery.mockReset();
});

describe("listPlayers league pool", () => {
  it("applies the league's configured division to the Players-tab query", async () => {
    dbQuery
      .mockResolvedValueOnce({ rows: [{ player_pool: "nl-central" }] })
      .mockResolvedValueOnce({ rows: [] });

    await listPlayers({ leagueId: LEAGUE_ID });

    expect(dbQuery).toHaveBeenCalledTimes(2);
    const playerSql = dbQuery.mock.calls[1][0] as string;
    expect(playerSql).toContain("mt.league ilike 'National%'");
    expect(playerSql).toContain("mt.division ilike '%Central%'");
  });

  it("does not add a team restriction for all-MLB leagues", async () => {
    dbQuery.mockResolvedValueOnce({ rows: [{ player_pool: "all" }] }).mockResolvedValueOnce({ rows: [] });

    await listPlayers({ leagueId: LEAGUE_ID });

    const playerSql = dbQuery.mock.calls[1][0] as string;
    expect(playerSql).not.toContain("mt.league ilike");
    expect(playerSql).not.toContain("mt.division ilike");
  });
});
