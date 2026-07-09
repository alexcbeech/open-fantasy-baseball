import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeClient = {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

let currentClient: FakeClient;

vi.mock("@/lib/db/client", () => ({
  getPool: () => ({ connect: async () => currentClient }),
}));

import { getDefaultScheduleWindow, syncMlbTeamsAndRosters } from "./mlb-sync";

describe("MLB sync", () => {
  it("uses a schedule window from yesterday through the next week", () => {
    expect(getDefaultScheduleWindow(new Date("2026-07-02T12:00:00.000Z"))).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-09",
    });
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
