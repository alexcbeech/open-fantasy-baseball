import { beforeEach, describe, expect, it, vi } from "vitest";
import { after, NextResponse } from "next/server";
import { GET, POST } from "./route";
import { requireAdminUser } from "@/lib/auth/admin";
import { isRateLimited } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/data/audit";
import { queueAdminAnnouncement, testAdminAnnouncement } from "@/lib/data/admin-announcements";
vi.mock("next/server", async original => ({ ...await original<object>(), after: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ requireAdminUser: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/data/admin-announcements", async original => ({ ...await original<object>(),
  listAdminAnnouncements: vi.fn(async () => []), announcementSettings: () => ({ configured: true }),
  queueAdminAnnouncement: vi.fn(), testAdminAnnouncement: vi.fn(),
}));
const id = "00000000-0000-4000-8000-000000000001";
const request = (body?: unknown, origin = "http://localhost") => new Request("http://localhost/api/v1/admin/announcements", {
  method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(isRateLimited).mockReturnValue(false);
  vi.mocked(requireAdminUser).mockResolvedValue({ user: { email: "admin@example.com", userId: id }, response: null } as never);
});
describe("announcement API", () => {
  it.each([401, 403])("protects all reads and mutations (%s)", async status => {
    vi.mocked(requireAdminUser).mockResolvedValue({ user: null, response: NextResponse.json({ error: "Access denied" }, { status }) });
    expect((await GET(request())).status).toBe(status);
    for (const action of ["create", "save", "review", "test", "send", "resume"]) {
      expect((await POST(request({ action, id, revision: 1 }))).status).toBe(status);
    }
    expect(queueAdminAnnouncement).not.toHaveBeenCalled(); expect(after).not.toHaveBeenCalled();
  });
  it("rejects foreign origins and rate limits sends", async () => {
    expect((await POST(request({ action: "create" }, "https://evil.test"))).status).toBe(403);
    vi.mocked(isRateLimited).mockReturnValue(true);
    expect((await POST(request({ action: "send", id, revision: 1 }))).status).toBe(429);
    expect(queueAdminAnnouncement).not.toHaveBeenCalled();
  });
  it("requires a reviewed audience token before sending", async () => {
    expect((await POST(request({ action: "send", id, revision: 1 }))).status).toBe(400);
    expect(after).not.toHaveBeenCalled();
  });
  it("tests only to the signed-in admin", async () => {
    expect((await POST(request({ action: "test", id, revision: 2, to: "other@example.com" }))).status).toBe(200);
    expect(testAdminAnnouncement).toHaveBeenCalledWith(id, 2, "admin@example.com");
  });
  it("commits the send before scheduling background work and audits the actor", async () => {
    const token = "a".repeat(64);
    expect((await POST(request({ action: "send", id, revision: 2, audienceToken: token }))).status).toBe(200);
    expect(queueAdminAnnouncement).toHaveBeenCalledWith(id, 2, token, "admin@example.com");
    expect(after).toHaveBeenCalledOnce();
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "announcement.send", entityId: id }));
  });
  it("does not start delivery after a failed queue transaction", async () => {
    vi.mocked(queueAdminAnnouncement).mockRejectedValueOnce(new Error("database failed"));
    expect((await POST(request({ action: "send", id, revision: 2, audienceToken: "a".repeat(64) }))).status).toBe(503);
    expect(after).not.toHaveBeenCalled();
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "announcement.failed" }));
  });
});
