import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: vi.fn() }));
vi.mock("@/lib/data/profile", () => ({ demoUserEmail: "demo@ofb.test" }));
vi.mock("@/lib/db/client", () => ({ getPool: () => ({ connect: async () => ({ query, release: vi.fn() }) }),
  tryDatabase: async (operation: () => Promise<unknown>, fallback: () => unknown) => { try { return await operation(); } catch { return fallback(); } } }));
import { ensureOfbUserForNeonAuth } from "./neon-auth";
const provider = { id: "provider-user", email: "changed@ofb.test", role: "admin" };
let account: Record<string, unknown>;
beforeEach(() => {
  query.mockReset();
  account = { id: "app-user", email: "original@ofb.test", display_name: "Manager", avatar_url: null, deactivated_at: null, sessions_valid_after: null };
  query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith("select u.*") ? [account] : [] }));
});
describe("session identity resolution", () => {
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
