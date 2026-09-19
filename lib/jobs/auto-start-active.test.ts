import { beforeEach, expect, it, vi } from "vitest";
import { setBotLineups } from "./bot-lineups";
import { getLeagueSettings } from "@/lib/data/leagues";
import { getLineupForTeam, saveLineupSlots } from "@/lib/data/teams";
import { recordAuditEvent } from "@/lib/data/audit";
import { defaultRosterSlots } from "@/lib/fantasy/defaults";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPool: () => ({ query }) }));
vi.mock("@/lib/data/leagues", () => ({ getLeagueSettings: vi.fn() }));
vi.mock("@/lib/data/teams", () => ({ getLineupForTeam: vi.fn(), saveLineupSlots: vi.fn(), LineupSaveError: class extends Error {} }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue({ rows: [{ id: "bot", league_id: "league", is_bot: true }, { id: "manager", league_id: "league", is_bot: false }] });
  vi.mocked(getLeagueSettings).mockResolvedValue({ lineupLockMode: "daily", rosterSlots: { ...defaultRosterSlots, OF: 1, UTIL: 0 } } as never);
  vi.mocked(getLineupForTeam).mockResolvedValue([{ slot: "BN", matchupTotal: 0, player: { id: "player", name: "Player", positions: ["OF"], status: "active", availability: "rostered", mlbTeam: "NYY", seasonStats: {}, projectedStats: {}, todaysGameStart: "2026-09-12T23:00:00Z" } }]);
});
it("selects bots and opted-in teams in playing leagues, saves and audits both", async () => {
  const result = await setBotLineups(new Date("2026-09-12T10:00:00Z"));
  expect(query).toHaveBeenCalledWith(expect.stringContaining("(ft.is_bot or ft.auto_start_active) and l.status in ('active', 'playoffs')"));
  expect(result).toMatchObject({ botTeamsSeen: 1, optedInTeamsSeen: 1, teamsUpdated: 2, playersMoved: 2 });
  expect(saveLineupSlots).toHaveBeenCalledWith("manager", [{ playerId: "player", slot: "OF" }]);
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "lineup.auto_start", teamId: "manager" }));
  expect(getLeagueSettings).toHaveBeenCalledTimes(1);
});
it("continues to the next team after a roster failure", async () => {
  vi.mocked(saveLineupSlots).mockRejectedValueOnce(new Error("Roster changed"));
  const result = await setBotLineups(new Date("2026-09-12T10:00:00Z"));
  expect(result.teamsUpdated).toBe(1);
  expect(result.teamsSkipped).toEqual([{ teamId: "bot", reason: "unexpected error: Roster changed" }]);
});
it("does not write or audit already-set lineups", async () => {
  vi.mocked(getLineupForTeam).mockResolvedValue([]);
  expect((await setBotLineups()).teamsUpdated).toBe(0);
  expect(saveLineupSlots).not.toHaveBeenCalled();
  expect(recordAuditEvent).not.toHaveBeenCalled();
});
it("excludes only active AI bots with valid credentials after the migration", async () => {
  query.mockResolvedValueOnce({ rows: [{ ready: true }] }).mockResolvedValueOnce({ rows: [] });
  await setBotLineups();
  expect(query.mock.calls[1][0]).toContain("ft.is_bot and b.enabled and b.token_hash is not null and b.token_expires_at > now()");
});
it("keeps ordinary automation available before the AI migration is applied", async () => {
  query.mockResolvedValueOnce({ rows: [{ ready: false }] }).mockResolvedValueOnce({ rows: [] });
  await setBotLineups();
  expect(query.mock.calls[1][0]).not.toContain("from ai_bot_manager");
});
