import { beforeEach, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { assertWeeklyPlayerAddAllowed } from "./player-actions";
import { getWeeklyPlayerAdds } from "./weekly-player-adds";

const query = vi.fn();
const client = { query } as unknown as PoolClient;
beforeEach(() => query.mockReset());

it.each([[5, 6, false], [6, 6, true], [7, 6, true], [6, 9, false], [0, 0, true]])(
  "enforces %i used against a commissioner limit of %i", async (used, limit, blocked) => {
    query.mockResolvedValue({ rows: [{ add_limit: limit, used: String(used) }] });
    const action = assertWeeklyPlayerAddAllowed(client, "league", "team");
    if (blocked) await expect(action).rejects.toMatchObject({ status: 409 });
    else await expect(action).resolves.toBeUndefined();
  },
);
it("allows acquisitions when the query returns no applicable H2H period", async () => {
  query.mockResolvedValue({ rows: [] });
  await expect(assertWeeklyPlayerAddAllowed(client, "roto", "team")).resolves.toBeUndefined();
});
it("uses the new period's count on every attempt instead of retaining the exhausted count", async () => {
  query.mockResolvedValueOnce({ rows: [{ add_limit: 6, used: "6" }] })
    .mockResolvedValueOnce({ rows: [{ add_limit: 6, used: "0" }] });
  await expect(assertWeeklyPlayerAddAllowed(client, "league", "team")).rejects.toMatchObject({ status: 409 });
  await expect(assertWeeklyPlayerAddAllowed(client, "league", "team")).resolves.toBeUndefined();
});
it("scopes the count to successful non-draft acquisitions in the current league matchup", async () => {
  query.mockResolvedValue({ rows: [] });
  await getWeeklyPlayerAdds(client, "league", "team");
  const [sql, params] = query.mock.calls[0];
  expect(params).toEqual(["league", "team"]);
  expect(sql).toContain("l.scoring_type <> 'roto'");
  expect(sql).toContain("sp.starts_at <= now() and sp.ends_at > now()");
  expect(sql).toContain("tx.type in ('add', 'waiver')");
  expect(sql).toContain("tx.status = 'processed'");
  expect(sql).toContain("? 'draftPick'");
  expect(sql).toContain(">= sp.starts_at");
  expect(sql).toContain("< sp.ends_at");
});

it("returns the persisted rollover timestamp with the count", async () => {
  query.mockResolvedValue({ rows: [{ add_limit: 6, used: "4", resets_at: new Date("2026-09-21T07:00:00Z") }] });
  await expect(getWeeklyPlayerAdds(client, "league", "team")).resolves.toEqual({ limit: 6, used: 4, resetsAt: "2026-09-21T07:00:00.000Z" });
});
