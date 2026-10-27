import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
const { redeemable } = vi.hoisted(() => ({ redeemable: vi.fn() }));
vi.mock("@/lib/data/league-invites", () => ({ isInviteTokenRedeemable: redeemable }));
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("@/lib/data/profile", () => ({ demoUserEmail: "demo@ofb.test" }));
vi.mock("@/lib/db/client", () => ({ getPool: () => ({ connect: async () => ({ query, release: vi.fn() }) }),
  tryDatabase: async (operation: () => Promise<unknown>, fallback: () => unknown) => { try { return await operation(); } catch { return fallback(); } } }));
import { ensureOfbUserForNeonAuth } from "./neon-auth";
const provider = { id: "provider-user", email: "changed@ofb.test", role: "admin" };
let account: Record<string, unknown>;
beforeEach(() => {
  query.mockReset();
  vi.stubEnv("ALLOW_SIGNUPS", "false");
  redeemable.mockReset().mockResolvedValue(false);
  account = { id: "app-user", email: "original@ofb.test", display_name: "Manager", avatar_url: null, deactivated_at: null, sessions_valid_after: null, identity_linked: true };
  query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("select u.*") ? [account] : [] }));
});
describe("session identity resolution", () => {
  it("does not link a new provider identity to an existing account by unverified email", async () => {
    account.identity_linked = false;
    expect(await ensureOfbUserForNeonAuth(provider, "2026-09-16")).toBeNull();
    expect(query.mock.calls.some(call => call[0].includes("insert into"))).toBe(false);
  });
  it("allows verified email linking while preserving the existing account", async () => {
    account.identity_linked = false;
    expect(await ensureOfbUserForNeonAuth({ ...provider, emailVerified: true }, "2026-09-16"))
      .toMatchObject({ userId: "app-user" });
  });
  it("does not enroll an upstream session that bypasses the closed-signup callback", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await ensureOfbUserForNeonAuth(provider, "2026-09-16")).toBeNull();
    expect(query.mock.calls.some(call => call[0].includes("insert into"))).toBe(false);
  });
  it("requires an explicit, redeemable invite addressed to the authenticated email", async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await ensureOfbUserForNeonAuth(provider, undefined, "expired-invite")).toBeNull();
    expect(redeemable).toHaveBeenCalledWith("expired-invite", provider.email, expect.objectContaining({ query }));
    expect(query.mock.calls.some(call => call[0].includes("insert into"))).toBe(false);
  });
  it("enrolls a new invited identity through the guarded signup path", async () => {
    redeemable.mockResolvedValue(true);
    query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("insert into app_user") ? [account] : [] }));
    expect(await ensureOfbUserForNeonAuth(provider, undefined, "valid-invite")).toMatchObject({ userId: "app-user" });
    expect(redeemable).toHaveBeenCalledWith("valid-invite", provider.email, expect.objectContaining({ query }));
  });
  it("does not attach an identity to an account concurrently created by another request", async () => {
    redeemable.mockResolvedValue(true);
    query.mockResolvedValue({ rows: [] });
    expect(await ensureOfbUserForNeonAuth(provider, undefined, "valid-invite")).toBeNull();
    expect(query.mock.calls.some(call => call[0].includes("insert into auth_identity"))).toBe(false);
  });
  it("keeps the linked app identity when the provider email changes", async () => {
    expect(await ensureOfbUserForNeonAuth(provider, "2026-09-16")).toMatchObject({ userId: "app-user", email: "original@ofb.test" });
    expect(query.mock.calls.some(call => call[0].includes("insert into app_user"))).toBe(false);
  });
  it("rejects cached sessions for inactive users without recreating or relinking them", async () => {
    account.deactivated_at = "2026-09-15";
    expect(await ensureOfbUserForNeonAuth(provider, "2026-09-16")).toBeNull();
    expect(query.mock.calls.some(call => call[0].includes("insert into"))).toBe(false);
  });
  it("rejects old sessions after reactivation", async () => {
    account.sessions_valid_after = "2026-09-15";
    expect(await ensureOfbUserForNeonAuth(provider, "2026-09-14")).toBeNull();
  });
  it("never fabricates an authenticated identity after a database error", async () => {
    query.mockRejectedValue(new Error("offline"));
    expect(await ensureOfbUserForNeonAuth(provider)).toBeNull();
  });
});
