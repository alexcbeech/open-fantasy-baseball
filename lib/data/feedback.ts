import { query, tryDatabase } from "@/lib/db/client";
import type { FeedbackCategory, FeedbackRecord, FeedbackStatus, FeedbackSubmission } from "./feedback-schema";

// Re-export the pure schema/types so existing importers of "@/lib/data/feedback"
// keep working; the DB-backed functions live here.
export * from "./feedback-schema";

type SubmitFeedbackContext = {
  userEmail: string | null;
  userAgent: string | null;
  authUserId: string | null;
};

type FeedbackRow = {
  id: string;
  category: FeedbackCategory;
  message: string;
  page_path: string | null;
  user_email: string | null;
  status: FeedbackStatus;
  github_issue_number: number | null;
  github_issue_url: string | null;
  created_at: string;
};

// Column list shared by the read/update queries below.
const feedbackColumns =
  "id, category, message, page_path, user_email, status, github_issue_number, github_issue_url, created_at";

function mapFeedbackRow(row: FeedbackRow): FeedbackRecord {
  return {
    id: row.id,
    category: row.category,
    message: row.message,
    pagePath: row.page_path,
    userEmail: row.user_email,
    status: row.status,
    githubIssueNumber: row.github_issue_number,
    githubIssueUrl: row.github_issue_url,
    createdAt: row.created_at,
  };
}

export async function submitFeedback(input: FeedbackSubmission, context: SubmitFeedbackContext) {
  const metadata: Record<string, unknown> = { ...(input.context ?? {}) };

  if (context.authUserId) {
    metadata.authUserId = context.authUserId;
  }

  return tryDatabase(
    async () => {
      // Resolve user_id from the session email in SQL so the FK is always valid
      // (the auth user id is not necessarily an app_user id).
      const result = await query<{ id: string; created_at: string }>(
        `insert into feedback (category, message, page_path, user_id, user_email, user_agent, metadata)
         values ($1, $2, $3, (select id from app_user where email = $4), $4, $5, $6::jsonb)
         returning id, created_at`,
        [input.category, input.message, input.pagePath ?? null, context.userEmail, context.userAgent, JSON.stringify(metadata)],
      );

      return { id: result.rows[0].id, createdAt: result.rows[0].created_at };
    },
    () => {
      // No database configured (local/demo): log so nothing is silently lost.
      console.info("[feedback] received (no database configured)", {
        category: input.category,
        message: input.message,
        pagePath: input.pagePath,
        userEmail: context.userEmail,
        metadata,
      });

      return { id: "demo-feedback", createdAt: new Date().toISOString() };
    },
  );
}

export async function listRecentFeedback(limit = 50): Promise<FeedbackRecord[]> {
  return tryDatabase(
    async () => {
      const result = await query<FeedbackRow>(
        `select ${feedbackColumns}
         from feedback
         order by created_at desc
         limit $1`,
        [limit],
      );

      return result.rows.map(mapFeedbackRow);
    },
    () => [],
  );
}

export async function getFeedbackById(id: string): Promise<FeedbackRecord | null> {
  return tryDatabase(
    async () => {
      const result = await query<FeedbackRow>(`select ${feedbackColumns} from feedback where id = $1 limit 1`, [id]);

      return result.rows[0] ? mapFeedbackRow(result.rows[0]) : null;
    },
    () => null,
  );
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackRecord | null> {
  return tryDatabase(
    async () => {
      const result = await query<FeedbackRow>(
        `update feedback
         set status = $2
         where id = $1
         returning ${feedbackColumns}`,
        [id, status],
      );

      return result.rows[0] ? mapFeedbackRow(result.rows[0]) : null;
    },
    () => null,
  );
}

export async function linkFeedbackIssue(
  id: string,
  issue: { number: number; url: string },
): Promise<FeedbackRecord | null> {
  return tryDatabase(
    async () => {
      const result = await query<FeedbackRow>(
        `update feedback
         set github_issue_number = $2,
             github_issue_url = $3,
             status = case when status = 'new' then 'reviewed' else status end
         where id = $1
         returning ${feedbackColumns}`,
        [id, issue.number, issue.url],
      );

      return result.rows[0] ? mapFeedbackRow(result.rows[0]) : null;
    },
    () => null,
  );
}
