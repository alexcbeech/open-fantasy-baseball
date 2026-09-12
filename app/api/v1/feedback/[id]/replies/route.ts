import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { recordAuditEvent } from "@/lib/data/audit";
import { getFeedbackById } from "@/lib/data/feedback";
import { createFeedbackDraft, feedbackReplySettings, FeedbackReplyError, listFeedbackReplies, saveFeedbackDraft, sendFeedbackReply } from "@/lib/data/feedback-replies";
import { replyDraftSchema, replySendSchema } from "@/lib/data/feedback-reply-schema";
import { isUuid } from "@/lib/db/client";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function handle(request: Request, context: Context) {
  const admin = await requireAdminUser();
  if (admin.response) return admin.response;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Feedback was not found." }, { status: 404 });
  const mutate = request.method !== "GET";
  if (mutate) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    if (isRateLimited(`feedback-replies:${admin.user.email}`, { limit: 30, windowMs: 60_000 })) {
      return NextResponse.json({ error: "Too many reply requests. Please wait a minute." }, { status: 429 });
    }
  }
  try {
    if (request.method === "GET") {
      if (!await getFeedbackById(id)) return NextResponse.json({ error: "Feedback was not found." }, { status: 404 });
      return NextResponse.json({ replies: await listFeedbackReplies(id), settings: feedbackReplySettings() }, { headers: { "Cache-Control": "no-store" } });
    }
    let reply;
    if (request.method === "POST") {
      reply = await createFeedbackDraft(id, admin.user.email);
    } else {
      const body: unknown = await request.json().catch(() => null);
      if (request.method === "PATCH") {
        const parsed = replyDraftSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "Use a one-line subject (up to 200 characters) and message up to 10,000 characters." }, { status: 400 });
        reply = await saveFeedbackDraft(id, parsed.data, admin.user.email);
      } else {
        const parsed = replySendSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "Invalid send request." }, { status: 400 });
        reply = await sendFeedbackReply(id, parsed.data.id, parsed.data.revision, parsed.data.closeFeedback, admin.user.email);
      }
    }
    await recordAuditEvent({ action: request.method === "PUT" ? "feedback.reply_send" : "feedback.reply_draft",
      actor: admin.user, entityType: "feedback", entityId: id, detail: { replyId: reply.id, status: reply.status }, request });
    return NextResponse.json({ reply });
  } catch (error) {
    if (mutate) await recordAuditEvent({ action: "feedback.reply_failed", actor: admin.user, entityType: "feedback", entityId: id, request });
    return NextResponse.json({ error: error instanceof FeedbackReplyError ? error.message : "Replies are temporarily unavailable. Your send may still be processing; reload before retrying." },
      { status: error instanceof FeedbackReplyError ? error.status : 503 });
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
