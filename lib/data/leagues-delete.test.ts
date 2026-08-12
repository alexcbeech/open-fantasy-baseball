import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

let currentClient: FakeClient;

vi.mock("@/lib/db/client", () => ({
  getPool: () => ({ connect: async () => currentClient }),
  query: vi.fn(),
  withDemoFallback: async (operation: () => unknown) => operation(),
}));

import { deleteLeague } from "./leagues";

const LEAGUE_ID = "00000000-0000-4000-8000-000000000001";
const creator = { userId: "00000000-0000-4000-8000-000000000002", email: "creator@example.com" };

function makeClient(row: { id: string; name: string; is_creator: boolean } | null): FakeClient {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("for update of l")) {
        return { rows: row ? [row] : [] };
      }

      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

function sqlCalls() {
  return currentClient.query.mock.calls.map(([sql]) => sql as string);
}

beforeEach(() => {
  currentClient = makeClient({ id: LEAGUE_ID, name: "Test League", is_creator: true });
});

describe("deleteLeague", () => {
  it("deletes a league when the caller is its original creator", async () => {
    await expect(deleteLeague(LEAGUE_ID, creator)).resolves.toEqual({ id: LEAGUE_ID, name: "Test League" });
    expect(sqlCalls()).toContain("delete from league where id = $1");
    expect(sqlCalls()).toContain("commit");
    expect(currentClient.release).toHaveBeenCalledOnce();
  });

  it("rejects a commissioner who is not the original creator", async () => {
    currentClient = makeClient({ id: LEAGUE_ID, name: "Test League", is_creator: false });

    await expect(deleteLeague(LEAGUE_ID, creator)).rejects.toMatchObject({ status: 403 });
    expect(sqlCalls()).not.toContain("delete from league where id = $1");
    expect(sqlCalls()).toContain("rollback");
  });

  it("returns not found without issuing a delete", async () => {
    currentClient = makeClient(null);

    await expect(deleteLeague(LEAGUE_ID, creator)).rejects.toMatchObject({ status: 404 });
    expect(sqlCalls()).not.toContain("delete from league where id = $1");
    expect(sqlCalls()).toContain("rollback");
  });
});
