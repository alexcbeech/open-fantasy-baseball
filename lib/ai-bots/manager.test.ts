import { beforeEach, expect, it, vi } from "vitest";
import { getBotOpponent, makeBotDecision } from "./manager";
import { applyPlayerManagementAction } from "@/lib/data/player-actions";
import { saveLineupSlots, getLineupForTeam } from "@/lib/data/teams";
import { getLeagueSettings } from "@/lib/data/leagues";
import { proposeTrade } from "@/lib/data/trades";
import { recordAuditEvent } from "@/lib/data/audit";
import type { BotDecision } from "./schema";
const { query, lockedQuery, release } = vi.hoisted(() => ({ query: vi.fn(), lockedQuery: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPool: () => ({ query, connect: async () => ({ query: lockedQuery, release }) }) }));
vi.mock("./coordinator", () => ({ getBotCoordinatorPool: () => ({ connect: async () => ({ query: lockedQuery, release }) }) }));
vi.mock("@/lib/data/player-actions", () => ({ applyPlayerManagementAction: vi.fn() }));
vi.mock("@/lib/data/teams", () => ({ saveLineupSlots: vi.fn(), getLineupForTeam: vi.fn() }));
vi.mock("@/lib/data/leagues", () => ({ getLeagueSettings: vi.fn() }));
vi.mock("@/lib/data/players", () => ({ getPlayerDetail: vi.fn(), listPlayers: vi.fn() }));
vi.mock("@/lib/data/trades", () => ({ proposeTrade: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: vi.fn() }));
const principal = { teamId: "bot-a", leagueId: "league-a", tokenHash: "hash-a" };
const decision: BotDecision = { requestId: "receipt", reason: "Replace injured catcher", command: { kind: "player", action: "add", playerId: "catcher" } };
let config: Record<string, unknown> | undefined;
let previous: Record<string, unknown> | undefined;
let used: number;
let same: boolean;
beforeEach(() => {
  vi.resetAllMocks(); previous = undefined; used = 0; same = true;
  config = { enabled: true, model: "chosen-model", allow_trades: false, manager_user_id: "sentinel", league_status: "active" };
  lockedQuery.mockImplementation(async (sql: string) => ({ rows: sql.includes("for no key update") && config ? [config] : [] }));
  query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("select command =") ? [{ same }] : sql.startsWith("select command,") ? previous ? [previous] : [] : sql.includes("count(*)") ? [{ used }] : [] }));
  vi.mocked(applyPlayerManagementAction).mockResolvedValue({ id: "catcher", name: "Catcher" } as never);
});
it.each(["paused", "expired", "offseason"])("blocks %s management before a mutation", async (state) => {
  if (state === "paused") config!.enabled = false;
  if (state === "expired") config = undefined;
  if (state === "offseason") config!.league_status = "complete";
  await expect(makeBotDecision(principal, decision)).rejects.toThrow();
  expect(applyPlayerManagementAction).not.toHaveBeenCalled(); expect(release).toHaveBeenCalled();
});
it("executes with the credential's team and records a receipt and audit", async () => {
  expect(await makeBotDecision(principal, decision)).toMatchObject({ status: "completed", replayed: false });
  expect(applyPlayerManagementAction).toHaveBeenCalledWith("bot-a", "catcher", "add", expect.any(Object));
  expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ teamId: "bot-a", detail: expect.objectContaining({ model: "chosen-model", reason: decision.reason }) }));
  expect(query.mock.calls.findIndex(([sql]) => sql.startsWith("insert"))).toBeLessThan(query.mock.calls.findIndex(([sql]) => sql.startsWith("update")));
});
it.each(["completed", "pending", "uncertain"])("does not reexecute a %s receipt", async (status) => {
  previous = { status, result: { saved: true } };
  expect(await makeBotDecision(principal, decision)).toMatchObject({ status, replayed: true });
  expect(applyPlayerManagementAction).not.toHaveBeenCalled();
});
it("rejects reuse of an ID with different arguments", async () => {
  previous = { status: "completed" }; same = false;
  await expect(makeBotDecision(principal, decision)).rejects.toThrow(/different decision/);
  expect(applyPlayerManagementAction).not.toHaveBeenCalled();
});
it("preserves uncertain outcomes instead of reporting a rollback", async () => {
  vi.mocked(applyPlayerManagementAction).mockRejectedValue(new Error("response failed after commit"));
  expect(await makeBotDecision(principal, decision)).toMatchObject({ status: "uncertain", result: { error: "response failed after commit" } });
});
it("enforces a durable daily decision cap", async () => {
  used = 40; await expect(makeBotDecision(principal, decision)).rejects.toThrow(/limit/);
  expect(applyPlayerManagementAction).not.toHaveBeenCalled();
});
it("does not read an opponent roster outside the assigned league", async () => {
  await expect(getBotOpponent(principal, "other-league-team")).rejects.toThrow(/assigned league/);
  expect(query).toHaveBeenCalledWith(expect.stringContaining("league_id = $2"), ["other-league-team", "league-a"]);
  expect(getLineupForTeam).not.toHaveBeenCalled();
});
it("requires explicit trade permission and restricts the shared bot owner identity", async () => {
  const proposal: BotDecision = { ...decision, command: { kind: "propose-trade", toTeamId: "opponent", offeredPlayerIds: ["a"], requestedPlayerIds: ["b"] } };
  expect(await makeBotDecision(principal, proposal)).toMatchObject({ status: "uncertain" });
  expect(proposeTrade).not.toHaveBeenCalled();
  config!.allow_trades = true;
  vi.mocked(proposeTrade).mockResolvedValue({ id: "offer" } as never);
  await makeBotDecision(principal, proposal);
  expect(proposeTrade).toHaveBeenCalledWith("league-a", expect.objectContaining({ fromTeamId: "bot-a", toTeamId: "opponent" }), { userId: "sentinel", email: "", botTeamId: "bot-a" });
});
it("enforces IL+ and NA settings before the shared lineup validator", async () => {
  vi.mocked(getLeagueSettings).mockResolvedValue({ allowILPlus: false, allowNA: false } as never);
  vi.mocked(getLineupForTeam).mockResolvedValue([{ player: { id: "hurt", status: "day-to-day" } }] as never);
  for (const slot of ["IL", "NA"] as const) {
    expect(await makeBotDecision(principal, { ...decision, command: { kind: "lineup", entries: [{ playerId: "hurt", slot }] } })).toMatchObject({ status: "uncertain" });
  }
  expect(saveLineupSlots).not.toHaveBeenCalled();
});
