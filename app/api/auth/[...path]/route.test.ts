import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handler: vi.fn(), getSession: vi.fn(), getCurrentOfbUser: vi.fn(), withEligibleRecipient: vi.fn() }));
vi.mock("@/lib/auth/neon-auth", () => ({ getCurrentOfbUser: mocks.getCurrentOfbUser,
  getNeonAuth: () => ({ getSession: mocks.getSession, handler: () => ({ GET: mocks.handler, POST: mocks.handler, PUT: mocks.handler, PATCH: mocks.handler, DELETE: mocks.handler }) }) }));
vi.mock("@/lib/auth/signups", () => ({ areSignupsEnabled: () => true }));
vi.mock("@/lib/notifications/recipient-guard", () => ({ withEligibleRecipient: mocks.withEligibleRecipient, DeliverySuppressed: class extends Error {} }));
import { POST } from "./route";
import { DeliverySuppressed } from "@/lib/notifications/recipient-guard";
function request(path: string) { return new Request(`https://ofb.test/api/auth/${path}`, { method: "POST", body: JSON.stringify({ email: "inactive@ofb.test" }) }); }
function post(req: Request) { return POST(req, { params: Promise.resolve({ path: new URL(req.url).pathname.split("/").slice(3) }) }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.getSession.mockResolvedValue({ data: null }); mocks.getCurrentOfbUser.mockResolvedValue(null);
  mocks.handler.mockResolvedValue(Response.json({ ok: true }));
  mocks.withEligibleRecipient.mockImplementation(async (_email, handler) => handler());
});
describe("auth proxy deactivation gates", () => {
  it.each(["sign-in/email", "sign-up/email", "request-password-reset", "send-verification-email", "email-otp/send-verification-otp"])("suppresses direct %s requests for inactive addresses", async path => {
    mocks.withEligibleRecipient.mockRejectedValue(new DeliverySuppressed());
    expect((await post(request(path))).status).toBe(403);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
  it("rejects cached inactive sessions but still permits sign-out", async () => {
    mocks.getSession.mockResolvedValue({ data: { user: { id: "inactive" } } });
    expect((await post(request("update-user"))).status).toBe(403);
    expect((await post(request("sign-out"))).status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledOnce();
  });
  it("does not expose provider admin routes that bypass OFB audit and anti-lockout", async () => {
    expect((await post(request("admin/unban-user"))).status).toBe(403);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
  it("fails closed when recipient verification fails", async () => {
    mocks.withEligibleRecipient.mockRejectedValue(new Error("offline"));
    expect((await post(request("request-password-reset"))).status).toBe(503);
    expect(mocks.handler).not.toHaveBeenCalled();
  });
});
