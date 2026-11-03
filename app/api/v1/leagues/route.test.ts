import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), create: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/neon-auth", () => ({ getCurrentOfbUser: mocks.user }));
vi.mock("@/lib/data/leagues", () => ({ createLeague: mocks.create }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: mocks.audit }));
import { POST } from "./route";

beforeEach(() => { vi.clearAllMocks(); });

describe("league creation authentication", () => {
  it("fails closed before parsing or persistence when production auth is unavailable", async () => {
    mocks.user.mockResolvedValue(null);
    const response = await POST(new Request("https://ofb.test/api/v1/leagues", { method: "POST", body: "untrusted body" }));
    expect(response.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
