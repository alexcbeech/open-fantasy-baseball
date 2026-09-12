import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { GET, POST, PATCH, PUT } from "./route";
import { requireAdminUser } from "@/lib/auth/admin";
import { recordAuditEvent } from "@/lib/data/audit";
import { sendFeedbackReply, saveFeedbackDraft } from "@/lib/data/feedback-replies";
import { isRateLimited } from "@/lib/rate-limit";

vi.mock("@/lib/auth/admin", () => ({ requireAdminUser: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/data/feedback", () => ({ getFeedbackById: vi.fn(async () => ({ id: "feedback" })) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: vi.fn() }));
vi.mock("@/lib/data/feedback-replies", async (importOriginal) => ({ ...await importOriginal<object>(),
  listFeedbackReplies: vi.fn(async () => []), feedbackReplySettings: () => ({ configured: true }),
  createFeedbackDraft: vi.fn(async () => ({ id: "reply", status: "draft" })),
  saveFeedbackDraft: vi.fn(), sendFeedbackReply: vi.fn(async () => ({ id: "reply", status: "sent" })),
}));
const id = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id }) };
const request = (method: string, body?: unknown, origin?: string) => new Request(`http://localhost/api/v1/feedback/${id}/replies`, {
  method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(isRateLimited).mockReturnValue(false);
  vi.mocked(requireAdminUser).mockResolvedValue({ user: { userId: id, email: "admin@example.com", displayName: "Admin", isAdmin: true }, response: null } as never);
});
describe("admin feedback replies", () => {
  it.each([[GET, "GET"], [POST, "POST"], [PATCH, "PATCH"], [PUT, "PUT"]] as const)("requires admin access for %s", async (handler, method) => {
    vi.mocked(requireAdminUser).mockResolvedValueOnce({ user: null, response: NextResponse.json({ error: "Sign in required" }, { status: 401 }) });
    expect((await handler(request(method), context)).status).toBe(401);
    vi.mocked(requireAdminUser).mockResolvedValueOnce({ user: null, response: NextResponse.json({ error: "Admin required" }, { status: 403 }) });
    expect((await handler(request(method), context)).status).toBe(403);
    expect(sendFeedbackReply).not.toHaveBeenCalled();
  });
  it("rate limits before creating or sending a reply", async () => {
    vi.mocked(isRateLimited).mockReturnValue(true);
    expect((await PUT(request("PUT", { id, revision: 1, closeFeedback: false }), context)).status).toBe(429);
    expect(sendFeedbackReply).not.toHaveBeenCalled();
  });
  it("rejects foreign origins and client-controlled recipients", async () => {
    expect((await POST(request("POST", undefined, "https://evil.test"), context)).status).toBe(403);
    expect((await PUT(request("PUT", { id, revision: 1, closeFeedback: false, to: "other@example.com" }), context)).status).toBe(400);
    expect(sendFeedbackReply).not.toHaveBeenCalled();
  });
  it("rejects header injection and oversized messages", async () => {
    for (const body of [{ id, revision: 1, subject: "Hello\r\nBcc: another", body: "Hello" }, { id, revision: 1, subject: "Hello", body: "x".repeat(10001) }]) {
      expect((await PATCH(request("PATCH", body), context)).status).toBe(400);
    }
    expect(saveFeedbackDraft).not.toHaveBeenCalled();
  });
  it("audits accepted sending without storing the message in the audit log", async () => {
    expect((await PUT(request("PUT", { id, revision: 1, closeFeedback: true }), context)).status).toBe(200);
    expect(sendFeedbackReply).toHaveBeenCalledWith(id, id, 1, true, "admin@example.com");
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "feedback.reply_send", detail: { replyId: "reply", status: "sent" } }));
  });
  it("audits failures and returns a recoverable error", async () => {
    vi.mocked(sendFeedbackReply).mockRejectedValueOnce(new Error("database unavailable"));
    expect((await PUT(request("PUT", { id, revision: 1, closeFeedback: false }), context)).status).toBe(503);
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "feedback.reply_failed" }));
  });
});
