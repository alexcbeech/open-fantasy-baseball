import { z } from "zod";
import { getPool, isDatabaseConfigured, query } from "@/lib/db/client";
import { getFeedbackById } from "./feedback";
import type { FeedbackReply, ReplySettings } from "./feedback-reply-schema";
import { replyDraftSchema } from "./feedback-reply-schema";
import { isEmailConfigured, sendEmail } from "@/lib/notifications/email";
import { feedbackEmailHtml, feedbackEmailText } from "@/lib/notifications/feedback-email";

export class FeedbackReplyError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const columns = `id, feedback_id as "feedbackId", recipient, subject, body, status, revision,
  author_email as "authorEmail", sender_email as "senderEmail", from_address as "fromAddress",
  reply_to as "replyTo", close_feedback as "closeFeedback", first_attempt_at::text as "firstAttemptAt",
  sent_at::text as "sentAt", created_at::text as "createdAt", error, provider_id as "providerId"`;

export function feedbackReplySettings(): ReplySettings {
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL?.trim() || null;
  return { configured: isEmailConfigured() && Boolean(replyTo && z.email().safeParse(replyTo).success),
    from: process.env.RESEND_FROM_EMAIL || null, replyTo };
}
export async function listFeedbackReplies(feedbackId: string) {
  if (!isDatabaseConfigured()) return [];
  return (await query<FeedbackReply>(`select ${columns} from feedback_reply where feedback_id = $1 order by created_at desc`, [feedbackId])).rows;
}
export async function createFeedbackDraft(feedbackId: string, author: string) {
  const feedback = await getFeedbackById(feedbackId);
  if (!feedback) throw new FeedbackReplyError("Feedback was not found.", 404);
  if (!z.email().safeParse(feedback.userEmail).success) throw new FeedbackReplyError("This feedback has no valid email address.", 400);
  // DO NOTHING + subsequent read also handles concurrent creation of the shared draft.
  await query(`insert into feedback_reply(feedback_id, recipient, subject, author_email)
    values ($1, $2, $3, $4) on conflict (feedback_id) where status = 'draft' do nothing`,
  [feedbackId, feedback.userEmail, "Re: Your Open Fantasy Baseball feedback", author]);
  return (await query<FeedbackReply>(`select ${columns} from feedback_reply where feedback_id = $1 and status = 'draft'`, [feedbackId])).rows[0];
}
export async function saveFeedbackDraft(feedbackId: string, draft: z.infer<typeof replyDraftSchema>, author: string) {
  const result = await query<FeedbackReply>(`update feedback_reply set subject = $4, body = $5, author_email = $6,
    revision = revision + 1, updated_at = now() where feedback_id = $1 and id = $2 and revision = $3 and status = 'draft'
    returning ${columns}`, [feedbackId, draft.id, draft.revision, draft.subject, draft.body, author]);
  if (!result.rows[0]) throw new FeedbackReplyError("This draft changed or was already sent. Reload replies before continuing.");
  return result.rows[0];
}

export function canRetryFeedbackReply(firstAttemptAt: string, now = Date.now()) {
  // Resend retains keys for 24h; leave an hour of margin and fail closed after that.
  return now - Date.parse(firstAttemptAt) < 23 * 60 * 60 * 1000;
}

export async function sendFeedbackReply(feedbackId: string, id: string, revision: number, closeFeedback: boolean, sender: string) {
  const settings = feedbackReplySettings();
  if (!settings.configured) throw new FeedbackReplyError("Feedback email needs an official sender and a monitored Reply-To inbox. Your draft is saved.", 503);
  const existing = (await query<FeedbackReply>(`select ${columns} from feedback_reply where feedback_id = $1 and id = $2`, [feedbackId, id])).rows[0];
  if (!existing) throw new FeedbackReplyError("Reply was not found.", 404);
  if (existing.status === "sent") return existing;
  if (existing.revision !== revision) throw new FeedbackReplyError("This draft changed. Reload replies before sending.");
  if (!existing.body.trim()) throw new FeedbackReplyError("Write a message before sending.", 400);
  if (existing.firstAttemptAt && !canRetryFeedbackReply(existing.firstAttemptAt)) {
    throw new FeedbackReplyError("The safe retry window has expired. Check this reply in Resend before composing another email.");
  }
  const feedback = await getFeedbackById(feedbackId);
  if (!feedback) throw new FeedbackReplyError("Feedback was not found.", 404);
  // Commit the immutable payload BEFORE contacting Resend. A crashed request can
  // resume after the lease, using the same payload and key even after a deployment.
  const claimed = await query<FeedbackReply & { html: string; emailText: string }>(`update feedback_reply set
    status = 'sending', attempt_at = now(), first_attempt_at = coalesce(first_attempt_at, now()),
    from_address = coalesce(from_address, $4), reply_to = coalesce(reply_to, $5),
    html = coalesce(html, $6), email_text = coalesce(email_text, $7),
    close_feedback = case when first_attempt_at is null then $8 else close_feedback end,
    sender_email = coalesce(sender_email, $9), error = null, updated_at = now()
    where feedback_id = $1 and id = $2 and revision = $3
      and (status in ('draft', 'unconfirmed') or (status = 'sending' and attempt_at < now() - interval '1 minute'))
      and (first_attempt_at is null or first_attempt_at > now() - interval '23 hours')
    returning ${columns}, html, email_text as "emailText"`,
  [feedbackId, id, revision, settings.from, settings.replyTo, feedbackEmailHtml(existing.body, feedback), feedbackEmailText(existing.body, feedback), closeFeedback, sender]);
  const reply = claimed.rows[0];
  if (!reply) throw new FeedbackReplyError("This reply is already sending or has changed. Reload replies in a minute.");
  const delivery = await sendEmail({ to: reply.recipient, from: reply.fromAddress!, replyTo: reply.replyTo!,
    subject: reply.subject, html: reply.html, text: reply.emailText, idempotencyKey: `feedback-reply/${id}` });
  if (!delivery.ok || !delivery.id) {
    const error = "Sending could not be confirmed. Retry this saved reply to safely check or resend it.";
    await query(`update feedback_reply set status = 'unconfirmed', error = $2, updated_at = now() where id = $1 and status = 'sending'`, [id, error]);
    throw new FeedbackReplyError(error, 502);
  }
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const saved = await client.query<FeedbackReply>(`update feedback_reply set status = 'sent', provider_id = $2,
      sent_at = now(), updated_at = now(), error = null where id = $1 returning ${columns}`, [id, delivery.id]);
    if (reply.closeFeedback) await client.query("update feedback set status = 'closed' where id = $1", [feedbackId]);
    await client.query("commit");
    return saved.rows[0];
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}
