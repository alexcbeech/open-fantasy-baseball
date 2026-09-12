import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canRetryFeedbackReply, feedbackReplySettings, saveFeedbackDraft, sendFeedbackReply } from "./feedback-replies";
import { query, getPool } from "@/lib/db/client";
import { sendEmail } from "@/lib/notifications/email";

vi.mock("@/lib/db/client", () => ({ query: vi.fn(), getPool: vi.fn(), isDatabaseConfigured: () => true }));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: vi.fn(), isEmailConfigured: () => true }));
const reply = { id: "reply", feedbackId: "feedback", recipient: "user@example.com", subject: "Thanks", body: "Hello",
  revision: 1, status: "draft", firstAttemptAt: null, fromAddress: "ofb@example.com", replyTo: "support@example.com",
  html: "<p>Hello</p>", emailText: "Hello", closeFeedback: true };
const tx = { query: vi.fn(), release: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("RESEND_REPLY_TO_EMAIL", "support@example.com"); vi.stubEnv("RESEND_FROM_EMAIL", "ofb@example.com");
  vi.mocked(getPool).mockReturnValue({ connect: async () => tx } as unknown as ReturnType<typeof getPool>);
});
afterEach(() => vi.unstubAllEnvs());
describe("feedback reply delivery", () => {
  it("requires a valid monitored inbox", () => {
    vi.stubEnv("RESEND_REPLY_TO_EMAIL", ""); expect(feedbackReplySettings().configured).toBe(false);
    vi.stubEnv("RESEND_REPLY_TO_EMAIL", "bad"); expect(feedbackReplySettings().configured).toBe(false);
  });
  it("rejects stale draft edits", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] } as never);
    await expect(saveFeedbackDraft("feedback", { id: "reply", revision: 1, subject: "Hi", body: "Hello" }, "admin")).rejects.toThrow("changed");
  });
  it("does not resend an accepted reply", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ ...reply, status: "sent" }] } as never);
    await sendFeedbackReply("feedback", "reply", 1, true, "admin");
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it("prevents concurrent sends when another request has claimed the reply", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [reply] } as never).mockResolvedValueOnce({ rows: [] } as never);
    await expect(sendFeedbackReply("feedback", "reply", 1, false, "admin")).rejects.toThrow("already sending");
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it("retries the stored payload and closes feedback only after provider acceptance", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [reply] } as never).mockResolvedValueOnce({ rows: [reply] } as never);
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, id: "provider" });
    tx.query.mockResolvedValue({ rows: [{ ...reply, status: "sent" }] });
    await sendFeedbackReply("feedback", "reply", 1, true, "admin");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "feedback-reply/reply", html: reply.html, from: reply.fromAddress }));
    expect(tx.query).toHaveBeenCalledWith("update feedback set status = 'closed' where id = $1", ["feedback"]);
    expect(tx.query).toHaveBeenLastCalledWith("commit");
  });
  it("records an unconfirmed attempt without closing feedback on timeout", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [reply] } as never).mockResolvedValueOnce({ rows: [reply] } as never).mockResolvedValueOnce({ rows: [] } as never);
    vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, reason: "timeout" });
    await expect(sendFeedbackReply("feedback", "reply", 1, true, "admin")).rejects.toThrow("could not be confirmed");
    expect(getPool).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining("status = 'unconfirmed'"), expect.any(Array));
  });
  it("fails closed after the provider's retry window", async () => {
    expect(canRetryFeedbackReply("2026-09-12T00:00:00Z", Date.parse("2026-09-12T22:59:59Z"))).toBe(true);
    expect(canRetryFeedbackReply("2026-09-12T00:00:00Z", Date.parse("2026-09-12T23:00:00Z"))).toBe(false);
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ ...reply, status: "unconfirmed", firstAttemptAt: "2000-01-01" }] } as never);
    await expect(sendFeedbackReply("feedback", "reply", 1, true, "admin")).rejects.toThrow("expired");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
