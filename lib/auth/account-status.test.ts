import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ query }));
import { acceptsSession, isAccountBlocked } from "./account-status";
beforeEach(() => query.mockReset());
describe("account access", () => {
  const cutoff = "2026-09-15T01:00:00Z";
  it("blocks deactivated accounts even with a new session", () => {
    expect(acceptsSession({ deactivated_at: cutoff, sessions_valid_after: null }, "2026-09-16")).toBe(false);
  });
  it("requires a strictly newer session after reactivation", () => {
    const account = { deactivated_at: null, sessions_valid_after: cutoff };
    for (const date of [undefined, "invalid", "2026-09-14", cutoff]) expect(acceptsSession(account, date)).toBe(false);
    expect(acceptsSession(account, "2026-09-15T01:00:01Z")).toBe(true);
  });
  it("preserves sessions for accounts never deactivated", () => {
    expect(acceptsSession({ deactivated_at: null, sessions_valid_after: null })).toBe(true);
  });
  it("checks normalized email and the stable provider subject", async () => {
    query.mockResolvedValue({ rows: [{ blocked: true }] });
    expect(await isAccountBlocked(" USER@ofb.test ", "subject")).toBe(true);
    expect(query.mock.calls[0][1]).toEqual(["USER@ofb.test", "subject"]);
  });
  it("fails closed when status cannot be verified", async () => {
    query.mockRejectedValue(new Error("offline"));
    await expect(isAccountBlocked("user@ofb.test")).rejects.toThrow("offline");
    query.mockResolvedValue({ rows: [] });
    expect(await isAccountBlocked("user@ofb.test")).toBe(true);
  });
});
