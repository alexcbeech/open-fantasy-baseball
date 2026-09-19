import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { isLeagueCommissioner } from "@/lib/auth/team-access";
import { configureBot, changeBotToken } from "@/lib/ai-bots/config";
import { recordAuditEvent } from "@/lib/data/audit";
import { resetRateLimiter } from "@/lib/rate-limit";
vi.mock("@/lib/auth/api-identity", () => ({ resolveApiIdentity: vi.fn() }));
vi.mock("@/lib/auth/team-access", () => ({ isLeagueCommissioner: vi.fn(), requireLeagueViewer: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true, isUuid: () => true }));
vi.mock("@/lib/ai-bots/config", () => ({ configureBot: vi.fn(), changeBotToken: vi.fn(), listBotManagers: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: vi.fn() }));
const teamId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ leagueId: "league" }) };
const identity = { userId: "commissioner", email: "c@example.com" };
const send = (body: unknown) => POST(new Request("http://localhost/api/v1/leagues/league/bot-managers", { method: "POST", body: JSON.stringify(body) }), context);
beforeEach(() => { vi.resetAllMocks(); resetRateLimiter(); vi.mocked(resolveApiIdentity).mockResolvedValue({ identity, response: null }); vi.mocked(isLeagueCommissioner).mockResolvedValue(true); });
it("denies non-commissioners before configuration or token issuance", async () => {
  vi.mocked(isLeagueCommissioner).mockResolvedValue(false);
  expect((await send({ action: "rotate-token", teamId })).status).toBe(403);
  expect(changeBotToken).not.toHaveBeenCalled();
});
it("requires a model before enabling but allows paused setup", async () => {
  const config = { teamId, model: "", strategy: "", enabled: true, allowTrades: false };
  expect((await send(config)).status).toBe(400);
  expect((await send({ ...config, enabled: false })).status).toBe(200);
  expect(configureBot).toHaveBeenCalledTimes(1);
});
it("returns a token once with no-store and never puts it in audit details", async () => {
  vi.mocked(changeBotToken).mockResolvedValue("ofb_bot_secret");
  const response = await send({ action: "rotate-token", teamId });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ token: "ofb_bot_secret" });
  expect(JSON.stringify(vi.mocked(recordAuditEvent).mock.calls)).not.toContain("ofb_bot_secret");
});
it("rate limits configuration mutations", async () => {
  for (let i = 0; i < 20; i++) await send({ action: "revoke-token", teamId });
  expect((await send({ action: "rotate-token", teamId })).status).toBe(429);
});
