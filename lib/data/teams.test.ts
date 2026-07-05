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
    expect(await listTeamsForCurrentUser()).toEqual([]);
  });
});
