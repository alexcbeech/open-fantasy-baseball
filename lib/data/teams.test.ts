import { beforeEach, describe, expect, it, vi } from "vitest";

// With a database configured, empty query results must stay empty -- they must
// NOT be replaced by mock/demo data. Mock the db client so the op runs against
// controlled rows.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  tryDatabase: async (op: () => unknown) => op(),
  query,
}));

import { getLineupForTeam, getTeamSummary, listTeamsForCurrentUser } from "./teams";

beforeEach(() => query.mockReset());

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
});
