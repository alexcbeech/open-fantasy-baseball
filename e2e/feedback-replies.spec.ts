import { expect, test } from "@playwright/test";

test("admin saves, previews, retries, and closes feedback without duplicate sends", async ({ page }) => {
  const feedbackId = "00000000-0000-4000-8000-000000000001";
  const replyId = "00000000-0000-4000-8000-000000000002";
  const feedback = { id: feedbackId, category: "issue", message: "The date changed too early.", userEmail: "user@example.com", status: "new", createdAt: "2026-09-12T12:00:00Z" };
  const base = { id: replyId, feedbackId, recipient: feedback.userEmail, subject: "Re: Your OFB feedback", body: "", revision: 1,
    status: "draft", authorEmail: "admin@example.com", senderEmail: null, fromAddress: null, replyTo: null,
    closeFeedback: false, firstAttemptAt: null, sentAt: null, createdAt: feedback.createdAt, error: null, providerId: null };
  let reply = { ...base };
  let created = false;
  let sends = 0;
  const sendIds: string[] = [];
  await page.route("**/api/v1/feedback", (route) => route.fulfill({ json: { feedback: [feedback] } }));
  await page.route(`**/api/v1/feedback/${feedbackId}/replies`, async (route) => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: { replies: created ? [reply] : [], settings: { configured: true, from: "OFB <support@example.com>", replyTo: "inbox@example.com" } } });
    if (method === "POST") { created = true; return route.fulfill({ json: { reply } }); }
    const data = route.request().postDataJSON();
    if (method === "PATCH") { reply = { ...reply, subject: data.subject, body: data.body, revision: reply.revision + 1 }; return route.fulfill({ json: { reply } }); }
    sends++; sendIds.push(data.id);
    if (sends === 1) {
      Object.assign(reply, { status: "unconfirmed", firstAttemptAt: new Date().toISOString(), closeFeedback: data.closeFeedback });
      return route.fulfill({ status: 502, json: { error: "Sending could not be confirmed. Retry this saved reply." } });
    }
    Object.assign(reply, { status: "sent", sentAt: new Date().toISOString(), senderEmail: "admin@example.com" });
    return route.fulfill({ json: { reply } });
  });
  async function openReplies() {
    await page.goto("/admin");
    await page.getByRole("region", { name: "User Feedback", exact: true }).getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("button", { name: "Reply by email / history" }).click();
  }
  await openReplies();
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await page.getByLabel("Subject", { exact: true }).fill("Thanks for reporting the date issue");
  await page.getByLabel("Message", { exact: true }).fill("We fixed the date issue.\n<script>Not executable</script>");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved.");
  await openReplies();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("We fixed the date issue.\n<script>Not executable</script>");
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(page.frameLocator('iframe[title="OFB email preview"]').getByText("<script>Not executable</script>", { exact: false })).toBeVisible();
  await expect(page.getByText("Reply-To: inbox@example.com", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Send and close feedback", exact: true }).click();
  await expect(page.getByRole("region", { name: "Feedback email reply", exact: true }).getByRole("alert")).toContainText("could not be confirmed");
  await expect(page.getByRole("button", { name: "Closed", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Retry saved reply", exact: true }).click();
  await expect(page.getByText("Sent · accepted by email provider", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry saved reply", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Closed", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(sendIds).toEqual([replyId, replyId]);
});
