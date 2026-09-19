import { beforeEach, expect, it, vi } from "vitest";
import { handleBotMcp } from "./mcp";
import { authenticateBot } from "./access";
import { makeBotDecision, getBotContext, searchBotPlayers } from "./manager";
import { resetRateLimiter } from "@/lib/rate-limit";
vi.mock("./access", () => ({ authenticateBot: vi.fn() }));
vi.mock("./manager", () => ({ makeBotDecision: vi.fn(), getBotContext: vi.fn(), getBotPlayer: vi.fn(), searchBotPlayers: vi.fn() }));
const principal = { teamId: "team-a", leagueId: "league-a", tokenHash: "hash-a" };
const decision = { requestId: "00000000-0000-4000-8000-000000000001", reason: "Keep the injured ace for his return", command: { kind: "note", note: "Use IL first" } };
const call = (name: string, args: unknown = {}) => handleBotMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, "Bearer secret");
beforeEach(() => { vi.resetAllMocks(); resetRateLimiter(); vi.mocked(authenticateBot).mockResolvedValue(principal); });
it("requires authentication for discovery as well as execution", async () => {
  vi.mocked(authenticateBot).mockResolvedValue(null);
  expect(await handleBotMcp({ jsonrpc: "2.0", id: 1, method: "tools/list" }, null)).toMatchObject({ error: { code: -32001 } });
  expect(await call("ofb_bot_decide", decision)).toMatchObject({ error: { code: -32001 } });
  expect(makeBotDecision).not.toHaveBeenCalled();
});
it("never accepts caller-selected team or league IDs", async () => {
  expect(await call("ofb_bot_decide", { ...decision, teamId: "team-b" })).toMatchObject({ error: { code: -32602 } });
  expect(await call("ofb_bot_context", { teamId: "team-b" })).toMatchObject({ error: { code: -32602 } });
  expect(await call("ofb_bot_players", { leagueId: "league-b" })).toMatchObject({ error: { code: -32602 } });
  expect(makeBotDecision).not.toHaveBeenCalled();
});
it("passes only the authenticated principal to the manager", async () => {
  vi.mocked(makeBotDecision).mockResolvedValue({ status: "completed" } as never);
  expect(await call("ofb_bot_decide", decision)).toMatchObject({ result: { isError: false } });
  expect(makeBotDecision).toHaveBeenCalledWith(principal, decision);
});
it("rejects unknown actions and marks uncertain outcomes as tool errors", async () => {
  expect(await call("ofb_bot_decide", { ...decision, command: { kind: "accept-trade" } })).toMatchObject({ error: { code: -32602 } });
  vi.mocked(makeBotDecision).mockResolvedValue({ status: "uncertain", result: { error: "Network failed" } } as never);
  expect(await call("ofb_bot_decide", decision)).toMatchObject({ result: { isError: true } });
});
it("scopes paginated searches and context to the token", async () => {
  await call("ofb_bot_players", { availability: "waivers", offset: 500, limit: 20 });
  expect(searchBotPlayers).toHaveBeenCalledWith(principal, { availability: "waivers", offset: 500, limit: 20 });
  await call("ofb_bot_context"); expect(getBotContext).toHaveBeenCalledWith(principal);
});
it("rate limits each team independently", async () => {
  for (let i = 0; i < 120; i++) await call("ofb_bot_context");
  expect(await call("ofb_bot_context")).toMatchObject({ error: { code: -32029 } });
  vi.mocked(authenticateBot).mockResolvedValue({ ...principal, teamId: "team-b" });
  expect(await call("ofb_bot_context")).toMatchObject({ result: { isError: false } });
});
