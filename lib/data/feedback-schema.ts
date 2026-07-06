import { z } from "zod";

// Pure constants, types, and zod schemas for feedback. This module intentionally
// has no database import so client components (e.g. the admin status controls and
// the feedback widget) can pull in the shared shapes without bundling `pg`.

export const feedbackCategories = ["idea", "issue"] as const;
export type FeedbackCategory = (typeof feedbackCategories)[number];

export const feedbackStatuses = ["new", "reviewed", "closed"] as const;
export type FeedbackStatus = (typeof feedbackStatuses)[number];

export const feedbackStatusUpdateSchema = z.object({
  status: z.enum(feedbackStatuses),
});

export const feedbackSubmissionSchema = z.object({
  category: z.enum(feedbackCategories),
  message: z
    .string()
    .trim()
    .min(1, "Please write a little about your feedback.")
    .max(2000, "Feedback must be 2000 characters or fewer."),
  pagePath: z.string().trim().max(512).optional(),
  // Free-form client context (viewport, theme, locale, ...). Scalars only so a
  // client can't smuggle nested payloads into the metadata column.
  context: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

export type FeedbackRecord = {
  id: string;
  category: FeedbackCategory;
  message: string;
  pagePath: string | null;
  userEmail: string | null;
  status: FeedbackStatus;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  createdAt: string;
};
