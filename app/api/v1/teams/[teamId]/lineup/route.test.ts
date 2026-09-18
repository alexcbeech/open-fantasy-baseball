import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LineupPlayer } from "@/lib/fantasy/types";
import { players } from "@/lib/fantasy/mock-data";
import { defaultLeagueSettings } from "@/lib/fantasy/defaults";

const mocks = vi.hoisted(() => ({ lineup: vi.fn(), save: vi.fn(), audit: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/auth/api-identity", () => ({ resolveApiIdentity: async () => ({ identity: { userId: "manager" } }) }));
vi.mock("@/lib/auth/team-access", () => ({ requireTeamManager: mocks.access }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/data/leagues", () => ({ getLeagueSettings: async () => defaultLeagueSettings }));
vi.mock("@/lib/data/teams", () => ({
  getLineupForTeam: mocks.lineup,
  getTeamSummary: async () => ({ leagueId: "league" }),
  saveLineupSlots: mocks.save,
  LineupSaveError: class extends Error {},
}));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true }));
import { PATCH } from "./route";

function patch(playerId: string, slot: string) {
  return PATCH(new Request("https://ofb.test/api/v1/teams/team/lineup", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries: [{ playerId, slot }] }),
  }), { params: Promise.resolve({ teamId: "team" }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue(null);
  const lineup: LineupPlayer[] = [
    { slot: "IL", matchupTotal: 0, player: { ...players[0], id: "jj", status: "active", positions: ["2B", "SS"], todaysGameStart: undefined } },
    { slot: "2B", matchupTotal: 0, player: { ...players[1], id: "nick", status: "active", positions: ["2B", "3B", "SS"], todaysGameStart: undefined } },
  ];
  mocks.lineup.mockResolvedValue(lineup);
});

describe("lineup moves with an ineligible IL occupant", () => {
  it.each([["nick", "3B"], ["jj", "BN"]])("saves %s to %s and audits the change", async (playerId, slot) => {
    const response = await patch(playerId, slot);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true });
    expect(mocks.save).toHaveBeenCalledWith("team", [{ playerId, slot }], undefined);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "lineup.save", teamId: "team" }));
  });

  it("rejects a new ineligible IL placement", async () => {
    expect(await (await patch("nick", "IL")).json()).toMatchObject({ accepted: false });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("still requires team management access", async () => {
    mocks.access.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await patch("nick", "3B")).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
