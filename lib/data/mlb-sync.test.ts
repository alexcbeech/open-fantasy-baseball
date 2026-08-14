import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

let currentClient: FakeClient;

vi.mock("@/lib/db/client", () => ({
  getPool: () => ({ connect: async () => currentClient }),
}));

import { getDefaultScheduleWindow, normalizeMlbRosterStatus, syncMlbSchedule, syncMlbTeamsAndRosters } from "./mlb-sync";

describe("MLB sync", () => {
  it("uses a schedule window from yesterday through the next week", () => {
    expect(getDefaultScheduleWindow(new Date("2026-07-02T12:00:00.000Z"))).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-09",
    });
  });

  it("preserves specific injured-list designations", () => {
    expect(normalizeMlbRosterStatus({ code: "D60", description: "Injured 60-Day" })).toEqual({
      status: "injured",
      statusDetail: "60-Day IL",
    });
    expect(normalizeMlbRosterStatus({ code: "D10", description: "Injured 10-Day" })).toEqual({
      status: "injured",
      statusDetail: "10-Day IL",
    });
  });
});

describe("syncMlbTeamsAndRosters player statuses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes MLB's D60 status instead of hard-coding active", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      void values;
      if (sql.includes("insert into ingestion_run")) return { rows: [{ id: "run-1" }] };
      if (sql.includes("insert into player (mlb_player_id, full_name, status, status_detail")) {
        return { rows: [{ id: "player-1", mlb_player_id: 804606 }] };
      }
      return { rows: [] };
    });
    currentClient = { query, release: vi.fn() };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const body = url.includes("/teams?sportId=1")
          ? { teams: [{ id: 134, abbreviation: "PIT", name: "Pittsburgh Pirates" }] }
          : url.includes("rosterType=40Man")
            ? {
                roster: [
                  {
                    person: { id: 804606, fullName: "Konnor Griffin" },
                    position: { abbreviation: "SS" },
                    status: { code: "D60", description: "Injured 60-Day" },
                  },
                ],
              }
            : url.includes("rosterType=active")
              ? { roster: [] }
              : { dates: [] };
        return { ok: true, json: async () => body };
      }),
    );

    await syncMlbTeamsAndRosters("https://example.test");

    const playerUpsert = query.mock.calls.find(([sql]) =>
      (sql as string).includes("insert into player (mlb_player_id, full_name, status, status_detail"),
    );
    expect(playerUpsert?.[1]?.[2]).toEqual(["injured"]);
    expect(playerUpsert?.[1]?.[3]).toEqual(["60-Day IL"]);
  });
});

// The schedule feed includes All-Star and exhibition games whose pseudo-teams
// (e.g. AL/NL All-Stars, ids 159/160) aren't in mlb_team; writing those games
// or their probable pitchers violates the team foreign keys.
describe("syncMlbSchedule game-type filtering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips non-regular/postseason games and their probable pitchers", async () => {
    const schedulePayload = {
      dates: [
        {
          games: [
            {
              gamePk: 1,
              gameType: "A",
              gameDate: "2026-07-14T23:00:00Z",
              teams: {
                away: { team: { id: 159 }, probablePitcher: { id: 900001, fullName: "AL Starter" } },
                home: { team: { id: 160 }, probablePitcher: { id: 900002, fullName: "NL Starter" } },
              },
            },
            {
              gamePk: 2,
              gameType: "R",
              gameDate: "2026-07-15T23:00:00Z",
              teams: {
                away: { team: { id: 121 } },
                home: { team: { id: 143 } },
              },
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => schedulePayload }),
    );
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as unknown[] }));

    const rowsSeen = await syncMlbSchedule({ query });

    expect(rowsSeen).toBe(2);
    const gameInserts = query.mock.calls.filter(([sql]) => sql.includes("insert into mlb_game"));
    expect(gameInserts).toHaveLength(1);
    // The batched insert's first parameter is the game_pk array.
    expect(gameInserts[0][1]?.[0]).toEqual([2]);
    // No player upsert for the All-Star probable pitchers either.
    expect(query.mock.calls.some(([sql]) => sql.includes("insert into player"))).toBe(false);
  });

  it("batches probable pitcher upserts and maps their ids into game rows", async () => {
    const schedulePayload = {
      dates: [
        {
          games: [
            {
              gamePk: 7,
              gameType: "R",
              gameDate: "2026-07-10T23:00:00Z",
              teams: {
                away: { team: { id: 121 }, probablePitcher: { id: 800001, fullName: "Away Ace" } },
                home: { team: { id: 143 }, probablePitcher: { id: 800002, fullName: "Home Ace" } },
              },
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => schedulePayload }),
    );
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("insert into player")) {
        return {
          rows: [
            { id: "uuid-away", mlb_player_id: 800001 },
            { id: "uuid-home", mlb_player_id: 800002 },
          ],
        };
      }
      return { rows: [] as unknown[] };
    });

    await syncMlbSchedule({ query });

    const pitcherUpserts = query.mock.calls.filter(([sql]) => sql.includes("insert into player"));
    expect(pitcherUpserts).toHaveLength(1);
    expect(pitcherUpserts[0][1]?.[0]).toEqual([800001, 800002]);

    const gameInsert = query.mock.calls.find(([sql]) => sql.includes("insert into mlb_game"));
    // Columns 9 and 10 of the batched insert are the home/away pitcher uuids.
    expect(gameInsert?.[1]?.[8]).toEqual(["uuid-home"]);
    expect(gameInsert?.[1]?.[9]).toEqual(["uuid-away"]);
  });
});

// A dangling 'started' run leaves the freshness indicator silently stale, so a
// failed sync must record the run as 'failed' for the admin panel.
describe("syncMlbTeamsAndRosters failure handling", () => {
  function makeClient(overrides: { failStatusUpdate?: boolean } = {}): FakeClient {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("insert into ingestion_run")) {
        return { rows: [{ id: "run-1" }] };
      }
      if (overrides.failStatusUpdate && sql.includes("update ingestion_run") && sql.includes("'failed'")) {
        throw new Error("connection terminated unexpectedly");
      }
      return { rows: [] };
    });

    return { query, release: vi.fn() };
  }

  beforeEach(() => {
    currentClient = makeClient();
    // The first upstream call (fetch teams) fails, standing in for the MLB API
    // being unreachable.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("MLB API is down")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records the ingestion run as failed (not left 'started') when the sync throws", async () => {
    await expect(syncMlbTeamsAndRosters()).rejects.toThrow("MLB API is down");

    const statements = currentClient.query.mock.calls.map((call) => call[0] as string);
    expect(statements.some((sql) => sql.includes("insert into ingestion_run"))).toBe(true);

    const failUpdate = currentClient.query.mock.calls.find(
      ([sql]) => (sql as string).includes("update ingestion_run") && (sql as string).includes("'failed'"),
    );
    expect(failUpdate).toBeDefined();
    // The error message is persisted for the admin panel's Recent Runs.
    expect((failUpdate?.[1] as unknown[])?.[1]).toBe("MLB API is down");
    expect(currentClient.release).toHaveBeenCalled();
  });

  it("propagates the original error even if recording the failure also fails", async () => {
    currentClient = makeClient({ failStatusUpdate: true });

    // Not "connection terminated" from the status write — the real cause wins.
    await expect(syncMlbTeamsAndRosters()).rejects.toThrow("MLB API is down");
    expect(currentClient.release).toHaveBeenCalled();
  });
});
