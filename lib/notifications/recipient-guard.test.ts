import { beforeEach, describe, expect, it, vi } from "vitest";
const { query, release } = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true, getPool: () => ({ connect: async () => ({ query, release }) }) }));
import { DeliverySuppressed, withEligibleRecipient } from "./recipient-guard";
beforeEach(() => { query.mockReset(); release.mockClear(); query.mockResolvedValue({ rows: [] }); });
describe("delivery suppression", () => {
  it("never contacts the provider for a deactivated recipient", async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("select deactivated") ? [{ deactivated_at: new Date(), sessions_valid_after: null }] : [] }));
    const deliver = vi.fn();
    await expect(withEligibleRecipient("user@ofb.test", deliver)).rejects.toBeInstanceOf(DeliverySuppressed);
    expect(deliver).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  });
  it("does not replay old queued messages after reactivation", async () => {
    query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("select deactivated") ? [{ deactivated_at: null, sessions_valid_after: "2026-09-15" }] : [] }));
    const deliver = vi.fn();
    await expect(withEligibleRecipient("user@ofb.test", deliver, "2026-09-14")).rejects.toBeInstanceOf(DeliverySuppressed);
    expect(deliver).not.toHaveBeenCalled();
  });
  it("allows new invitations to addresses without an account and releases the lock after delivery", async () => {
    const deliver = vi.fn(async () => "sent");
    expect(await withEligibleRecipient("invitee@ofb.test", deliver)).toBe("sent");
    expect(query.mock.calls[1][0]).toContain("pg_advisory_xact_lock_shared");
    expect(query.mock.calls.at(-1)?.[0]).toBe("commit");
  });
  it("does not send when the database fails", async () => {
    query.mockRejectedValue(new Error("offline")); const deliver = vi.fn();
    await expect(withEligibleRecipient("user@ofb.test", deliver)).rejects.toThrow("offline");
    expect(deliver).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
  });
});
