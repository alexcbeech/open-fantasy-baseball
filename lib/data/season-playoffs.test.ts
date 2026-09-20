import { describe, expect, it, vi } from "vitest";
import { activateDuePeriods } from "./season";

async function seed(botsEligible: boolean | null, botIds = ["t2"], count = 2) {
  const teams = ["t4", "t2", "t1", "t3"].map((id) => ({ id, name: id, is_bot: botIds.includes(id) }));
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("select id from scoring_period")) return { rows: [] };
    if (sql.includes("returning id, is_playoff")) return { rows: [{ id: "period", is_playoff: true, playoff_round: 1 }] };
    if (sql.includes("count(*) as n")) return { rows: [{ n: 0 }] };
    if (sql.includes("max(playoff_round)")) return { rows: [{ total: Math.ceil(Math.log2(count)) }] };
    if (sql.includes("botsEligibleForPlayoffs")) return { rows: [{ playoff_team_count: count, bots_eligible: botsEligible }] };
    if (sql.includes("select id, name, is_bot")) return { rows: teams };
    if (sql.includes("group by team_id")) return { rows: [1, 2, 3, 4].map((n) => ({ team_id: "t" + n, wins: 5 - n, losses: n, ties: 0, points: 0 })) };
    return { rows: [] };
  });
  await activateDuePeriods({ query } as unknown as Parameters<typeof activateDuePeriods>[0], "league");
  const calls = query.mock.calls as unknown as [string, unknown[]][];
  return {
    seeds: calls.filter(([sql]) => sql.includes("set playoff_seed = $2")).map(([, values]) => values),
    matchups: calls.filter(([sql, values]) => sql.includes("insert into matchup") && !values[4]).map(([, values]) => values.slice(0, 4)),
    consolation: calls.filter(([sql, values]) => sql.includes("insert into matchup") && values[4]).map(([, values]) => values.slice(2, 4)),
  };
}

describe("playoff qualification", () => {
  it("skips the second-place bot and qualifies first and third place", async () => {
    expect(await seed(false)).toEqual({ seeds: [["t1", 1], ["t3", 2]], matchups: [["league", "period", "t1", "t3"]], consolation: [["t2", "t4"]] });
  });
  it.each([true, null])("includes bots when enabled or missing in legacy settings (%s)", async (enabled) => {
    expect((await seed(enabled)).seeds).toEqual([["t1", 1], ["t2", 2]]);
  });
  it("skips consecutive top-ranked bots", async () => {
    expect((await seed(false, ["t1", "t2"])).seeds).toEqual([["t3", 1], ["t4", 2]]);
  });
  it("leaves unfilled spots empty instead of admitting bots", async () => {
    expect(await seed(false, ["t1", "t2", "t3"], 4)).toEqual({ seeds: [["t4", 1]], matchups: [], consolation: [["t2", "t3"]] });
  });
  it("keeps an all-bot league in consolation when bots cannot qualify", async () => {
    expect(await seed(false, ["t1", "t2", "t3", "t4"])).toEqual({ seeds: [], matchups: [], consolation: [["t1", "t2"], ["t3", "t4"]] });
  });
  it("creates a third-place final alongside a four-team league's championship", async () => {
    expect(await seed(true)).toEqual({ seeds: [["t1", 1], ["t2", 2]], matchups: [["league", "period", "t1", "t2"]], consolation: [["t3", "t4"]] });
  });
  it("creates no consolation bracket if everyone qualifies", async () => {
    expect((await seed(true, [], 4)).consolation).toEqual([]);
  });
});

describe("later playoff rounds", () => {
  it("advances winners and byes within each persisted bracket, including tied games", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("select id from scoring_period")) return { rows: [] };
      if (sql.includes("returning id, is_playoff")) return { rows: [{ id: "final", is_playoff: true, playoff_round: 2 }] };
      if (sql.includes("count(*) as n")) return { rows: [{ n: 0 }] };
      if (sql.includes("max(playoff_round)")) return { rows: [{ total: 2 }] };
      if (sql.includes("select id, playoff_seed")) return { rows: [
        ...[1, 2, 3, 4].map((n) => ({ id: `t${n}`, playoff_seed: n, consolation_seed: null, consolation_bracket: null })),
        ...[5, 6, 7].map((n) => ({ id: `t${n}`, playoff_seed: null, consolation_seed: n - 4, consolation_bracket: 1 })),
      ] };
      if (sql.includes("select sp.playoff_round")) return { rows: [
        { playoff_round: 1, home_team_id: "t1", away_team_id: "t4", home_score: 0, away_score: 1 },
        { playoff_round: 1, home_team_id: "t2", away_team_id: "t3", home_score: 2, away_score: 2 },
        { playoff_round: 1, home_team_id: "t6", away_team_id: "t7", home_score: 0, away_score: 1 },
      ] };
      return { rows: [] };
    });
    await activateDuePeriods({ query } as unknown as Parameters<typeof activateDuePeriods>[0], "league");
    const calls = query.mock.calls as unknown as [string, unknown[]][];
    expect(calls.filter(([sql]) => sql.includes("insert into matchup")).map(([, values]) => values)).toEqual([
      ["league", "final", "t2", "t4", false],
      ["league", "final", "t5", "t7", true],
    ]);
    expect(calls.some(([sql]) => sql.includes("set playoff_seed"))).toBe(false);
  });
  it("does not reseed an already populated playoff period", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("returning id, is_playoff")) return { rows: [{ id: "period", is_playoff: true, playoff_round: 1 }] };
      if (sql.includes("count(*) as n")) return { rows: [{ n: 2 }] };
      return { rows: [] };
    });
    await activateDuePeriods({ query } as unknown as Parameters<typeof activateDuePeriods>[0], "league");
    expect(query.mock.calls.some(([sql]) => sql.includes("insert into matchup") || sql.includes("set playoff_seed"))).toBe(false);
  });
});
