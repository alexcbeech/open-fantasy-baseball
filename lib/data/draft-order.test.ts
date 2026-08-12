import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { appendTeamToSetupDraft, reconcileSetupDraftOrder } from "./draft-order";

function fakeClient(handler: (sql: string) => { rows: unknown[] }) {
  return { query: vi.fn(async (sql: string) => handler(sql)) } as unknown as PoolClient;
}

describe("draft order membership", () => {
  it("appends a newly joined team to a setup draft", async () => {
    const client = fakeClient((sql) => {
      if (sql.includes("select id from draft")) return { rows: [{ id: "draft-1" }] };
      if (sql.includes("next_position")) return { rows: [{ next_position: 3 }] };
      return { rows: [] };
    });

    await appendTeamToSetupDraft(client, "league-1", "team-3");

    const insert = vi.mocked(client.query).mock.calls.find(([sql]) => String(sql).includes("insert into draft_order"));
    expect(insert?.[1]).toEqual(["draft-1", 3, "team-3"]);
  });

  it("is a no-op when draft setup has not been created", async () => {
    const client = fakeClient(() => ({ rows: [] }));

    await appendTeamToSetupDraft(client, "league-1", "team-1");

    expect(vi.mocked(client.query)).toHaveBeenCalledTimes(1);
  });

  it("repairs every missing team in stable join order", async () => {
    const client = fakeClient((sql) => {
      if (sql.includes("from fantasy_team")) return { rows: [{ id: "ryan" }, { id: "late-manager" }] };
      if (sql.includes("max_position")) return { rows: [{ max_position: 1 }] };
      return { rows: [] };
    });

    await reconcileSetupDraftOrder(client, "draft-1", "league-1");

    const inserts = vi
      .mocked(client.query)
      .mock.calls.filter(([sql]) => String(sql).includes("insert into draft_order"))
      .map(([, values]) => values);
    expect(inserts).toEqual([
      ["draft-1", 2, "ryan"],
      ["draft-1", 3, "late-manager"],
    ]);
  });
});
