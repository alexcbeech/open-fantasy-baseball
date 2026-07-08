import { beforeEach, describe, expect, it, vi } from "vitest";

// saveLineupSlots re-validates the whole resulting lineup inside its
// transaction (under an advisory lock) so a save that raced the route's
// pre-check can't persist an illegal lineup. These drive a fake pool client to
// assert that guard without a real database.

type FakeClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

let currentClient: FakeClient;

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  tryDatabase: async (op: () => unknown) => op(),
  withDemoFallback: async (op: () => unknown) => op(),
  query: vi.fn(),
  getPool: () => ({ connect: async () => currentClient }),
}));

import { LineupSaveError, saveLineupSlots } from "./teams";

type LineupRow = {
  slot: string;
  id: string;
  full_name: string;
  status: string;
  positions: string[];
  todays_game_start: string | null;
};

function lineupRow(overrides: Partial<LineupRow> & Pick<LineupRow, "id" | "slot">): LineupRow {
  return {
    full_name: `Player ${overrides.id}`,
    status: "active",
    positions: ["C"],
    todays_game_start: null,
    ...overrides,
  };
}

function makeClient(lineupRows: LineupRow[]): FakeClient {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("player_position_eligibility")) {
      return { rows: lineupRows };
    }
    if (sql.includes("select league_id from fantasy_team")) {
      return { rows: [{ league_id: "league-1" }] };
    }
    if (sql.includes("from scoring_period")) {
      return { rows: [{ id: "scoring-period-1" }] };
    }
    if (sql.includes("coalesce(max(lineup_date)")) {
      return { rows: [{ lineup_date: "2026-07-08" }] };
    }
    return { rows: [] };
  });

  return { query, release: vi.fn() };
}

function sqlCalls() {
  return currentClient.query.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  currentClient = makeClient([]);
});

describe("saveLineupSlots atomic re-validation", () => {
  it("rejects a save that would overfill a slot and never writes", async () => {
    // C allows one player; both catchers in C overfills it.
    currentClient = makeClient([
      lineupRow({ id: "catcher-a", slot: "C", positions: ["C"] }),
      lineupRow({ id: "catcher-b", slot: "BN", positions: ["C"] }),
    ]);

    await expect(saveLineupSlots("team-1", [{ playerId: "catcher-b", slot: "C" }])).rejects.toBeInstanceOf(LineupSaveError);

    const calls = sqlCalls();
    expect(calls.some((sql) => sql.includes("insert into lineup_entry"))).toBe(false);
    expect(calls).toContain("rollback");
    expect(currentClient.release).toHaveBeenCalled();
  });

  it("rejects moving a game-locked player", async () => {
    currentClient = makeClient([
      lineupRow({ id: "locked-star", slot: "C", positions: ["C"], todays_game_start: "2000-01-01T00:00:00.000Z" }),
    ]);

    await expect(saveLineupSlots("team-1", [{ playerId: "locked-star", slot: "BN" }])).rejects.toThrow(/locked/i);
    expect(sqlCalls().some((sql) => sql.includes("insert into lineup_entry"))).toBe(false);
  });

  it("rejects an entry for a player who is not on the team", async () => {
    currentClient = makeClient([lineupRow({ id: "on-team", slot: "C", positions: ["C"] })]);

    await expect(saveLineupSlots("team-1", [{ playerId: "stranger", slot: "BN" }])).rejects.toThrow(/not on this team/i);
  });

  it("takes the per-team advisory lock before reading the lineup", async () => {
    currentClient = makeClient([lineupRow({ id: "catcher-a", slot: "C", positions: ["C"] })]);

    await saveLineupSlots("team-1", [{ playerId: "catcher-a", slot: "BN" }]);

    const calls = sqlCalls();
    const lockIndex = calls.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
    const readIndex = calls.findIndex((sql) => sql.includes("player_position_eligibility"));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(readIndex);
  });

  it("persists and commits a legal lineup change", async () => {
    currentClient = makeClient([
      lineupRow({ id: "catcher-a", slot: "C", positions: ["C"] }),
      lineupRow({ id: "bench-bat", slot: "BN", positions: ["C"] }),
    ]);

    // Move the catcher to the bench: nothing overfilled, nothing locked.
    await saveLineupSlots("team-1", [{ playerId: "catcher-a", slot: "BN" }]);

    const calls = sqlCalls();
    expect(calls.some((sql) => sql.includes("insert into lineup_entry"))).toBe(true);
    expect(calls.some((sql) => sql.includes("insert into fantasy_transaction"))).toBe(true);
    expect(calls).toContain("commit");
  });
});
