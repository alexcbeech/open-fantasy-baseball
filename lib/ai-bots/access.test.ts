import { beforeEach, expect, it, vi } from "vitest";
import { authenticateBot, hashBotToken } from "./access";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true, getPool: () => ({ query }) }));
beforeEach(() => vi.resetAllMocks());
it("rejects ordinary user tokens, malformed tokens, and missing credentials", async () => {
  for (const token of [null, "Bearer ofb_user", "Bearer ofb_bot_short", "Basic something"]) expect(await authenticateBot(token)).toBeNull();
  expect(query).not.toHaveBeenCalled();
});
it("looks up only a hash and binds the principal to the stored bot and league", async () => {
  const token = `ofb_bot_${"a".repeat(43)}`;
  query.mockResolvedValue({ rows: [{ team_id: "a", league_id: "league" }] });
  expect(await authenticateBot(`Bearer ${token}`)).toEqual({ teamId: "a", leagueId: "league", tokenHash: hashBotToken(token) });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("b.token_expires_at > now() and ft.is_bot"), [hashBotToken(token)]);
  query.mockResolvedValue({ rows: [] });
  expect(await authenticateBot(`Bearer ${token}`)).toBeNull();
});
