import { expect, it, vi } from "vitest";

const { client } = vi.hoisted(() => ({ client: { query: vi.fn(), release: vi.fn() } }));
vi.mock("@/lib/db/client", () => ({
  getPool: () => ({ connect: async () => client }),
  isDatabaseConfigured: () => true,
  isUniqueViolation: () => false,
}));
vi.mock("@/lib/data/notifications", () => ({ buildWaiverNotification: vi.fn(), enqueueNotificationForTeam: vi.fn() }));
vi.mock("@/lib/data/lineup-snapshots", () => ({ ensureTodayLineupSnapshot: async () => null }));
vi.mock("@/lib/data/trades", () => ({ processDueTrades: async () => ({ tradesProcessed: 0, tradesFailed: 0, tradesDeferred: 0 }) }));
vi.mock("@/lib/data/players", () => ({ getPlayerDetail: vi.fn() }));

import { runNightlyProcessing } from "./nightly-processing";

it("rechecks queued claims after each win and awards the next eligible team without exceeding six", async () => {
  const used: Record<string, number> = { a: 5, b: 0 };
  const claim = (id: string, team: string, player: string, priority: number) => ({
    id, league_id: "league", team_id: team, add_player_id: player, drop_player_id: null,
    bid_amount: null, priority_at_claim: priority, created_at: new Date(), league_settings: {},
  });
  client.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("insert into background_job_run")) return { rows: [{ id: "run" }] };
    if (sql.includes("from waiver_claim wc")) return { rows: [claim("first", "a", "p1", 1), claim("exhausted", "a", "p2", 1), claim("runner-up", "b", "p2", 2)] };
    if (sql.includes("select exists")) return { rows: [{ exists: false }] };
    if (sql.includes("as add_limit")) return { rows: [{ add_limit: 6, used: used[String(params[1])] }] };
    if (sql.includes("insert into fantasy_transaction")) used[String(params[1])]++;
    return { rows: [] };
  });
  const result = await runNightlyProcessing();
  expect(result).toMatchObject({ waiverClaimsWon: 2, waiverClaimsLost: 1, transactionsCreated: 2 });
  expect(used).toEqual({ a: 6, b: 1 });
  const adds = client.query.mock.calls.filter(([sql]) => sql.includes("insert into roster_entry"));
  expect(adds.map(([, params]) => params)).toEqual([["a", "p1"], ["b", "p2"]]);
  expect(client.query).toHaveBeenCalledWith("update waiver_claim set status = $2 where id = $1", ["exhausted", "lost"]);
});
