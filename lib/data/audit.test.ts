import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@/lib/db/client", () => ({
  isDatabaseConfigured: () => true,
  query: queryMock,
}));

import { listAuditEventPage } from "./audit";

const ids = [
  "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000001",
];

function row(id: string) {
  return {
    id,
    occurred_at: new Date("2026-08-30T17:00:00.000Z"),
    actor_user_id: null,
    actor_email: "admin@example.com",
    action: "player.add",
    entity_type: "player",
    entity_id: id,
    league_id: null,
    team_id: null,
    detail: {},
    ip: null,
    user_agent: null,
  };
}

beforeEach(() => {
  queryMock.mockReset();
});

describe("listAuditEventPage", () => {
  it("uses the event id to page safely across identical timestamps", async () => {
    queryMock.mockResolvedValue({ rows: ids.map(row) });

    const page = await listAuditEventPage({
      before: "2026-08-30T17:00:00.000Z",
      beforeId: "00000000-0000-4000-8000-000000000004",
      limit: 2,
    });

    const [sql, values] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("(occurred_at, id) < ($1::timestamptz, $2::uuid)");
    expect(sql).toContain("order by occurred_at desc, id desc");
    expect(values).toEqual([
      "2026-08-30T17:00:00.000Z",
      "00000000-0000-4000-8000-000000000004",
      3,
    ]);
    expect(page.events.map((event) => event.id)).toEqual(ids.slice(0, 2));
    expect(page.hasMore).toBe(true);
  });

  it("reports the final page without requiring a second empty request", async () => {
    queryMock.mockResolvedValue({ rows: [row(ids[0])] });

    const page = await listAuditEventPage({ limit: 2 });

    expect(page.events).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(queryMock.mock.calls[0][1]).toEqual([3]);
  });
});
