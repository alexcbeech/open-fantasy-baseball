import { z } from "zod";

export const replyDraftSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  subject: z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/, "Subject must be one line."),
  body: z.string().max(10000),
}).strict();
export const replySendSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(), closeFeedback: z.boolean(),
}).strict();

export type FeedbackReply = {
  id: string; feedbackId: string; recipient: string; subject: string; body: string;
  status: "draft" | "sending" | "sent" | "unconfirmed" | "canceled";
  revision: number; authorEmail: string; senderEmail: string | null;
  fromAddress: string | null; replyTo: string | null; closeFeedback: boolean;
  firstAttemptAt: string | null; sentAt: string | null; createdAt: string;
  error: string | null; providerId: string | null;
};
export type ReplySettings = { configured: boolean; from: string | null; replyTo: string | null };
