import { beforeEach, describe, expect, it, vi } from "vitest";

// With a database configured, empty query results must stay empty -- they must
// NOT be replaced by mock/demo data. Mock the db client so the op runs against
// controlled rows.
const { poolQuery, query } = vi.hoisted(() => ({ poolQuery: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  getPool: () => ({ query: poolQuery }),
  isDatabaseConfigured: () => true,
  tryDatabase: async (op: () => unknown) => op(),
  withDemoFallback: async (op: () => unknown) => op(),
  query,
  isUniqueViolation: () => false,
}));

import { getLineupForTeam, getTeamSummary, listTeamsForCurrentUser, updateTeamName } from "./teams";

beforeEach(() => {
  poolQuery.mockReset();
  query.mockReset();
});

describe("teams data layer with a configured database", () => {
  it("returns an empty lineup for a real team that has no lineup rows", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const lineup = await getLineupForTeam("00000000-0000-4000-8000-000000000303");
    expect(lineup).toEqual([]);
  });

  it("returns undefined for a team that does not exist (not a mock team)", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const team = await getTeamSummary("00000000-0000-4000-8000-0000000000ff");
    expect(team).toBeUndefined();
  });

  it("returns an empty team list when the user has no teams", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await listTeamsForCurrentUser({ userId: "00000000-0000-4000-8000-000000000001", email: "a@b.c" })).toEqual([]);
  });

  it("returns an empty team list without querying when no user is signed in", async () => {
    expect(await listTeamsForCurrentUser(null)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("filters the team query by the user's id or email", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listTeamsForCurrentUser({ userId: "demo-user", email: "alex@example.local" });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/u\.id::text = \$1 or u\.email = \$2/);
    expect(params).toEqual(["demo-user", "alex@example.local"]);
  });

  it("renames a team and returns the normalized stored name", async () => {
    query.mockResolvedValueOnce({ rows: [{ name: "Moon Shots" }] });

    await expect(updateTeamName("team-1", "Moon Shots")).resolves.toBe("Moon Shots");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("update fantasy_team"), ["team-1", "Moon Shots"]);
  });

  it("computes standings once when multiple managed teams share a league", async () => {
    const shared = {
      league_id: "00000000-0000-4000-8000-000000000010",
      league_name: "Shared League",
      manager_name: "Alex",
      scoring_type: "h2h-points",
      matchup_label: null,
      period_starts: null,
      period_ends: null,
      opponent_name: null,
      user_score: 0,
      opponent_score: 0,
    } as const;
    query
      .mockResolvedValueOnce({
        rows: [
          { ...shared, id: "00000000-0000-4000-8000-000000000101", team_name: "Aces" },
          { ...shared, id: "00000000-0000-4000-8000-000000000102", team_name: "Bats" },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: "00000000-0000-4000-8000-000000000101", name: "Aces" },
          { id: "00000000-0000-4000-8000-000000000102", name: "Bats" },
        ],
      });
    poolQuery.mockResolvedValueOnce({ rows: [] });

    const teams = await listTeamsForCurrentUser({ userId: "demo-user", email: "alex@example.local" });

    expect(teams.map((team) => team.rank)).toEqual([1, 2]);
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
