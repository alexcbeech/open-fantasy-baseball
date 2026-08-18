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
  it("applies the league's configured player pool in the Players-tab query", async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] });

    await listPlayers({ leagueId: LEAGUE_ID });

    expect(dbQuery).toHaveBeenCalledTimes(1);
    const playerSql = dbQuery.mock.calls[0][0] as string;
    expect(playerSql).toContain("join league pool_league");
    expect(playerSql).toContain("pool_league.settings->>'playerPool'");
    expect(playerSql).toContain("mt.league ilike 'National%'");
    expect(playerSql).toContain("mt.division ilike '%Central%'");
    expect(dbQuery.mock.calls[0][1]).toContain(LEAGUE_ID);
  });

  it("defaults missing league player-pool settings to all MLB", async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] });

    await listPlayers({ leagueId: LEAGUE_ID });

    const playerSql = dbQuery.mock.calls[0][0] as string;
    expect(playerSql).toContain("coalesce(pool_league.settings->>'playerPool', 'all') = 'all'");
    expect(playerSql).toContain("left join (\n            select distinct player_id, position");
  });

  it("includes today's probable-starter signal in player-list rows", async () => {
    dbQuery.mockResolvedValueOnce({ rows: [] });

    await listPlayers({ leagueId: LEAGUE_ID });

    const playerSql = dbQuery.mock.calls[0][0] as string;
    expect(playerSql).toContain("as todays_probable_starter");
    expect(playerSql).toContain("bool_or(g.home_probable_pitcher_player_id = p.id");
    expect(playerSql).toContain("g.official_date");
    expect(playerSql).toContain("America/New_York");
  });
});
