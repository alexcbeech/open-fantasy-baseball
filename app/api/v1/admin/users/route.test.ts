import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdminUser: vi.fn(), isRateLimited: vi.fn(), changeAccount: vi.fn(), listAdminUsers: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: mocks.isRateLimited }));
vi.mock("@/lib/db/client", () => ({ isDatabaseConfigured: () => true }));
vi.mock("@/lib/data/admin-users", () => ({ ...mocks, AccountChangeError: class extends Error {} }));
import { GET, POST } from "./route";
const command = { userId: "00000000-0000-4000-8000-000000000002", revision: 0, action: "deactivate" };
function request(body: unknown = command, origin = "https://ofb.test") { return new Request("https://ofb.test/api/v1/admin/users", { method: "POST", headers: { origin }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.requireAdminUser.mockResolvedValue({ response: null, user: { userId: "admin", email: "admin@ofb.test", isAdmin: true } }); mocks.isRateLimited.mockReturnValue(false); mocks.listAdminUsers.mockResolvedValue([]); mocks.changeAccount.mockResolvedValue({ authSyncPending: false }); });
describe("user administration routes", () => {
  it("enforces authentication and admin authorization before reading or writing", async () => {
    for (const status of [401, 403]) {
      mocks.requireAdminUser.mockResolvedValue({ response: Response.json({}, { status }) });
      expect((await GET(request())).status).toBe(status); expect((await POST(request())).status).toBe(status);
    }
    expect(mocks.changeAccount).not.toHaveBeenCalled(); expect(mocks.listAdminUsers).not.toHaveBeenCalled();
  });
  it("rejects cross-origin, invalid, and rate-limited writes", async () => {
    expect((await POST(request(command, "https://evil.test"))).status).toBe(403);
    expect((await POST(request({ ...command, revision: -1 }))).status).toBe(400);
    mocks.isRateLimited.mockReturnValue(true); expect((await POST(request())).status).toBe(429);
    expect(mocks.changeAccount).not.toHaveBeenCalled();
  });
  it("returns a no-store list and delegates valid mutations", async () => {
    expect((await GET(new Request("https://ofb.test/api/v1/admin/users"))).headers.get("cache-control")).toBe("no-store");
    expect((await POST(request())).status).toBe(200); expect(mocks.changeAccount).toHaveBeenCalledOnce();
  });
});
