import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({
  query,
  withDemoFallback: async (operation: () => unknown) => operation(),
}));

import { buildLeagueTransactionItems, listLeagueTransactions, type FantasyTransactionRow } from "./transactions";

const names = new Map([
  ["player-a", "Aaron Judge"],
  ["player-b", "Bobby Witt Jr."],
  ["player-c", "Corbin Carroll"],
]);

function row(overrides: Partial<FantasyTransactionRow> & Pick<FantasyTransactionRow, "id" | "type">): FantasyTransactionRow {
  return {
    team_id: "team-a",
    team_name: "Moon Shots",
    payload: {},
    occurred_at: "2026-08-22T17:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  query.mockReset();
});

describe("buildLeagueTransactionItems", () => {
  it("maps adds, drops, waivers, and draft acquisitions to public events", () => {
    const result = buildLeagueTransactionItems(
      [
        row({ id: "add", type: "add", payload: { playerId: "player-a" } }),
        row({ id: "drop", type: "drop", payload: { playerId: "player-b" } }),
        row({
          id: "waiver",
          type: "waiver",
          payload: { addPlayerId: "player-c", dropPlayerId: "player-b", bidAmount: 7 },
        }),
        row({ id: "draft", type: "add", payload: { playerId: "player-a", draftPick: 12 } }),
      ],
      names,
    );

    expect(result.map((item) => item.category)).toEqual(["add", "drop", "waiver", "draft"]);
    expect(result[0].title).toBe("Moon Shots added Aaron Judge");
    expect(result[1].title).toBe("Moon Shots dropped Bobby Witt Jr.");
    expect(result[2]).toMatchObject({
      title: "Moon Shots claimed Corbin Carroll off waivers",
      details: ["Dropped Bobby Witt Jr.", "Winning FAAB bid: $7"],
    });
    expect(result[3]).toMatchObject({ title: "Moon Shots drafted Aaron Judge", details: ["Pick 12"] });
  });

  it("collapses both team audit rows into one completed trade", () => {
    const result = buildLeagueTransactionItems(
      [
        row({
          id: "trade-a",
          type: "trade",
          team_id: "team-a",
          team_name: "Moon Shots",
          payload: { tradeId: "trade-1", incoming: ["player-a"], outgoing: ["player-b"] },
        }),
        row({
          id: "trade-b",
          type: "trade",
          team_id: "team-b",
          team_name: "Fastballs",
          payload: { tradeId: "trade-1", incoming: ["player-b"], outgoing: ["player-a"], dropped: ["player-c"] },
        }),
      ],
      names,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "trade:trade-1",
      category: "trade",
      title: "Moon Shots and Fastballs completed a trade",
      details: [
        "Moon Shots acquired Aaron Judge · sent Bobby Witt Jr.",
        "Fastballs acquired Bobby Witt Jr. · sent Aaron Judge · dropped Corbin Carroll",
      ],
    });
  });

  it("sorts the final event list newest first", () => {
    const result = buildLeagueTransactionItems(
      [
        row({ id: "old", type: "add", payload: { playerId: "player-a" }, occurred_at: "2026-08-20T17:00:00.000Z" }),
        row({ id: "new", type: "drop", payload: { playerId: "player-b" }, occurred_at: "2026-08-22T17:00:00.000Z" }),
      ],
      names,
    );

    expect(result.map((item) => item.id)).toEqual(["new", "old"]);
  });
});

describe("listLeagueTransactions", () => {
  it("returns processed public roster events and resolves player names", async () => {
    query
      .mockResolvedValueOnce({
        rows: [row({ id: "add", type: "add", payload: { playerId: "player-a" } })],
      })
      .mockResolvedValueOnce({ rows: [{ id: "player-a", full_name: "Aaron Judge" }] });

    const result = await listLeagueTransactions("league-1");

    expect(result[0].title).toBe("Moon Shots added Aaron Judge");
    expect(query.mock.calls[0][0]).toContain("tx.status = 'processed'");
    expect(query.mock.calls[0][0]).toContain("tx.type <> 'lineup_change'");
    expect(query.mock.calls[0][1]).toEqual(["league-1"]);
    expect(query.mock.calls[1][1]).toEqual([["player-a"]]);
  });

  it("skips the player lookup when the league has no transactions", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(listLeagueTransactions("league-1")).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
