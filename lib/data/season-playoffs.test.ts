import { describe, expect, it, vi } from "vitest";
import { activateDuePeriods } from "./season";

async function seed(botsEligible: boolean | null, botIds = ["t2"], count = 2) {
  const teams = ["t4", "t2", "t1", "t3"].map((id) => ({ id, name: id, is_bot: botIds.includes(id) }));
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("select id from scoring_period")) return { rows: [] };
    if (sql.includes("returning id, is_playoff")) return { rows: [{ id: "period", is_playoff: true, playoff_round: 1 }] };
    if (sql.includes("count(*) as n")) return { rows: [{ n: 0 }] };
    if (sql.includes("max(playoff_round)")) return { rows: [{ total: 1 }] };
    if (sql.includes("botsEligibleForPlayoffs")) return { rows: [{ playoff_team_count: count, bots_eligible: botsEligible }] };
    if (sql.includes("select id, name, is_bot")) return { rows: teams };
    if (sql.includes("group by team_id")) return { rows: [1, 2, 3, 4].map((n) => ({ team_id: "t" + n, wins: 5 - n, losses: n, ties: 0, points: 0 })) };
    return { rows: [] };
  });
  await activateDuePeriods({ query } as unknown as Parameters<typeof activateDuePeriods>[0], "league");
  const calls = query.mock.calls as unknown as [string, unknown[]][];
  return {
    seeds: calls.filter(([sql]) => sql.includes("set playoff_seed = $2")).map(([, values]) => values),
    matchups: calls.filter(([sql]) => sql.includes("insert into matchup")).map(([, values]) => values),
  };
}

describe("playoff qualification", () => {
  it("skips the second-place bot and qualifies first and third place", async () => {
    expect(await seed(false)).toEqual({ seeds: [["t1", 1], ["t3", 2]], matchups: [["league", "period", "t1", "t3"]] });
  });
  it.each([true, null])("includes bots when enabled or missing in legacy settings (%s)", async (enabled) => {
    expect((await seed(enabled)).seeds).toEqual([["t1", 1], ["t2", 2]]);
  });
  it("skips consecutive top-ranked bots", async () => {
    expect((await seed(false, ["t1", "t2"])).seeds).toEqual([["t3", 1], ["t4", 2]]);
  });
  it("leaves unfilled spots empty instead of admitting bots", async () => {
    expect(await seed(false, ["t1", "t2", "t3"], 4)).toEqual({ seeds: [["t4", 1]], matchups: [] });
  });
  it("handles an all-bot league without matchups", async () => {
    expect(await seed(false, ["t1", "t2", "t3", "t4"])).toEqual({ seeds: [], matchups: [] });
  });
});
