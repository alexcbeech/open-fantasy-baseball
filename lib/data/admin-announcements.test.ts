import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPool, query } from "@/lib/db/client";
import { sendEmail } from "@/lib/notifications/email";
import { eligibleAnnouncementEmails, processAdminAnnouncement, queueAdminAnnouncement, saveAdminAnnouncement } from "./admin-announcements";
import { announcementContentSchema } from "./admin-announcement-schema";
import { announcementEmailHtml, announcementEmailText } from "@/lib/notifications/announcement-email";
vi.mock("@/lib/db/client", () => ({ query: vi.fn(), getPool: vi.fn(), isDatabaseConfigured: () => true }));
vi.mock("@/lib/notifications/email", () => ({ sendEmail: vi.fn() }));
vi.mock("./feedback-replies", () => ({ feedbackReplySettings: () => ({ configured: true, from: "support@ofb.test", replyTo: "support@ofb.test" }) }));
const content = { subject: "Playoff update", body: '<script>alert("x")</script>\nStandings updated.', buttonLabel: "Standings", buttonUrl: "https://openfantasy.app" };
const result = (rows: unknown[] = [], rowCount = rows.length) => ({ rows, rowCount }) as never;
beforeEach(() => { vi.resetAllMocks(); });
describe("announcement safety", () => {
  it("normalizes and deduplicates addresses and excludes invalid/demo addresses", () => {
    expect(eligibleAnnouncementEmails(["User@ofb.test", " user@ofb.test ", "broken", "alex@example.local", "seed@example.com"])).toEqual(["user@ofb.test"]);
  });
  it("escapes HTML while preserving plain text and validates link/header inputs", () => {
    expect(announcementEmailHtml(content)).toContain("&lt;script&gt;");
    expect(announcementEmailHtml(content)).not.toContain("<script>");
    expect(announcementEmailText(content)).toContain(content.body);
    for (const change of [{ subject: "Hello\r\nBcc: x" }, { buttonUrl: "javascript:alert(1)" }, { buttonLabel: "" }, { body: "" }]) {
      expect(announcementContentSchema.safeParse({ ...content, ...change }).success).toBe(false);
    }
  });
  it("rejects stale edits", async () => {
    vi.mocked(query).mockResolvedValue(result());
    await expect(saveAdminAnnouncement("id", 1, content, "admin")).rejects.toThrow("changed");
  });
  it("rolls back rather than sending to a changed audience", async () => {
    const tx = vi.fn().mockResolvedValue(result()).mockResolvedValueOnce(result()).mockResolvedValueOnce(result([{ status: "draft", revision: 1 }]));
    vi.mocked(getPool).mockReturnValue({ connect: async () => ({ query: tx, release: vi.fn() }) } as never);
    vi.mocked(query).mockResolvedValueOnce(result([content])).mockResolvedValueOnce(result([{ email: "user@ofb.test" }]));
    await expect(queueAdminAnnouncement("id", 1, "stale-token", "admin")).rejects.toThrow("recipient list changed");
    expect(tx).toHaveBeenCalledWith("rollback"); expect(sendEmail).not.toHaveBeenCalled();
  });
  it("does not resnapshot a previously queued announcement", async () => {
    const tx = vi.fn().mockResolvedValue(result()).mockResolvedValueOnce(result()).mockResolvedValueOnce(result([{ status: "queued", revision: 1 }]));
    vi.mocked(getPool).mockReturnValue({ connect: async () => ({ query: tx, release: vi.fn() }) } as never);
    await queueAdminAnnouncement("id", 1, "token", "admin");
    expect(query).not.toHaveBeenCalled(); expect(tx).toHaveBeenCalledWith("commit");
  });
  it("retains immutable payload/key when delivery is unconfirmed", async () => {
    const payload = { subject: "Saved subject", html: "saved html", text: "saved text", from: "old@ofb.test", replyTo: "reply@ofb.test" };
    vi.mocked(query).mockResolvedValueOnce(result([payload])).mockResolvedValueOnce(result()).mockResolvedValueOnce(result([{ email: "user@ofb.test" }])).mockResolvedValueOnce(result());
    vi.mocked(sendEmail).mockResolvedValue({ ok: false, reason: "timeout" });
    await processAdminAnnouncement("id");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ ...payload, to: "user@ofb.test", idempotencyKey: expect.stringMatching(/^announcement\/id\//) }));
    expect(query).toHaveBeenLastCalledWith(expect.any(String), ["id", "user@ofb.test", "unconfirmed", null]);
  });
});
