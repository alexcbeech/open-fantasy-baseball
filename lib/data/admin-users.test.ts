import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), revokeUserSessions: vi.fn(), banUser: vi.fn(), unbanUser: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true, query: mocks.query,
  getPool: () => ({ connect: async () => ({ query: mocks.query, release: mocks.release }) }) }));
vi.mock("@/lib/auth/neon-auth", () => ({ getNeonAuth: () => ({ admin: mocks }) }));
import { changeAccount } from "./admin-users";
import type { OfbCurrentUser } from "@/lib/auth/neon-auth";
const admin = { userId: "00000000-0000-4000-8000-000000000001", email: "admin@ofb.test", isAdmin: true } as OfbCurrentUser;
const command = { userId: "00000000-0000-4000-8000-000000000002", revision: 0, action: "deactivate" as const, reason: "Requested by manager" };
const request = new Request("https://ofb.test/api/v1/admin/users");
let activeActor: boolean;
let target: { email: string; deactivated_at: Date | null; account_revision: number; auth_sync_pending: boolean };
beforeEach(() => {
  vi.clearAllMocks(); activeActor = true;
  target = { email: "user@ofb.test", deactivated_at: null, account_revision: 0, auth_sync_pending: false };
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("select id from app_user")) return { rows: activeActor ? [{ id: admin.userId }] : [] };
    if (sql.startsWith("select email, deactivated")) return { rows: [target] };
    if (sql.startsWith("select provider_subject")) return { rows: [{ provider_subject: "provider-user" }] };
    return { rows: [] };
  });
  mocks.revokeUserSessions.mockResolvedValue({ error: null }); mocks.banUser.mockResolvedValue({ error: null }); mocks.unbanUser.mockResolvedValue({ error: null });
});
describe("admin account changes", () => {
  it("revokes credentials, cancels deliveries and audits in the transaction", async () => {
    expect(await changeAccount(command, admin, request)).toEqual({ authSyncPending: false });
    const sql = mocks.query.mock.calls.map(call => call[0]).join("\n");
    for (const table of ["oauth_access_token", "oauth_client", "push_subscription", "notification_outbox", "admin_announcement_recipient", "feedback_reply", "audit_log"]) expect(sql).toContain(table);
    expect(mocks.banUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "provider-user" }));
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("commit");
  });
  it("commits a local block with a retryable warning when the provider fails", async () => {
    mocks.banUser.mockResolvedValue({ error: { message: "unavailable" } });
    expect(await changeAccount(command, admin, request)).toEqual({ authSyncPending: true });
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("commit");
  });
  it("keeps the account inactive if reactivation cannot synchronize", async () => {
    target.deactivated_at = new Date(); mocks.unbanUser.mockResolvedValue({ error: {} });
    await expect(changeAccount({ ...command, action: "reactivate" }, admin, request)).rejects.toThrow("remains deactivated");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
  it("reactivates without restoring revoked credentials or notifications", async () => {
    target.deactivated_at = new Date();
    await changeAccount({ ...command, action: "reactivate" }, admin, request);
    const sql = mocks.query.mock.calls.map(call => call[0]).join("\n");
    expect(sql).toContain("sessions_valid_after = clock_timestamp()");
    expect(sql).not.toContain("update oauth_access_token"); expect(sql).not.toContain("update notification_outbox");
  });
  it("prevents self-deactivation and non-admin changes", async () => {
    await expect(changeAccount({ ...command, userId: admin.userId }, admin, request)).rejects.toThrow("own account");
    await expect(changeAccount(command, { ...admin, isAdmin: false }, request)).rejects.toThrow("Admin access");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("rechecks the actor under the lock and rejects stale requests", async () => {
    activeActor = false; await expect(changeAccount(command, admin, request)).rejects.toThrow("no longer active");
    activeActor = true; target.account_revision = 1;
    await expect(changeAccount(command, admin, request)).rejects.toThrow("account changed");
    expect(mocks.banUser).not.toHaveBeenCalled();
  });
  it("rolls back if the audit cannot be recorded", async () => {
    const original = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (...args) => { if (args[0].startsWith("insert into audit_log")) throw new Error("audit offline"); return original(...args); });
    await expect(changeAccount(command, admin, request)).rejects.toThrow("audit offline");
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("rollback");
  });
});
