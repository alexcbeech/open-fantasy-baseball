import { getPool, tryDatabase } from "@/lib/db/client";
import { drainNotifications } from "@/lib/data/notifications";
import { formatDraftTime } from "@/lib/draft/schedule";

export type DraftReminderResult = {
  notified: number;
  skipped: string | null;
};

/**
 * Pre-draft reminder for a scheduled draft. Enqueued when a commissioner sets
 * a start time (run_at ≈ one hour before). No-ops when the draft already
 * started or was rescheduled after this job was queued — a fresh job carries
 * the new time. Idempotent via the outbox dedup guard below.
 */
export async function runDraftReminder(payload: Record<string, unknown>): Promise<DraftReminderResult> {
  const leagueId = typeof payload.leagueId === "string" ? payload.leagueId : null;
  const scheduledStartAt = typeof payload.scheduledStartAt === "string" ? payload.scheduledStartAt : null;

  if (!leagueId || !scheduledStartAt) {
    return { notified: 0, skipped: "Missing leagueId or scheduledStartAt in payload." };
  }

  return tryDatabase(
    async () => {
      const pool = getPool();
      const draft = await pool.query<{ id: string; status: string; scheduled_start_at: Date | null; league_name: string }>(
        `select d.id, d.status, d.scheduled_start_at, l.name as league_name
         from draft d
         join league l on l.id = d.league_id
         where d.league_id = $1`,
        [leagueId],
      );
      const row = draft.rows[0];

      if (!row || row.status !== "setup") {
        return { notified: 0, skipped: "Draft already started or was removed." };
      }

      if (!row.scheduled_start_at || row.scheduled_start_at.toISOString() !== new Date(scheduledStartAt).toISOString()) {
        return { notified: 0, skipped: "Draft was rescheduled; a newer reminder job owns the new time." };
      }

      // One reminder per human manager per scheduled time: the anti-join makes
      // a retried job a no-op for anyone already queued.
      const inserted = await pool.query(
        `insert into notification_outbox (user_id, type, title, body, url)
         select distinct ft.manager_user_id, 'draft_scheduled', $2, $3, $4
         from fantasy_team ft
         where ft.league_id = $1 and ft.is_bot = false
           and not exists (
             select 1 from notification_outbox n
             where n.user_id = ft.manager_user_id and n.type = 'draft_scheduled' and n.title = $2 and n.body = $3
           )`,
        [
          leagueId,
          "Draft starts soon",
          `The ${row.league_name} draft starts ${formatDraftTime(row.scheduled_start_at)}. Open seats will be filled with bots.`,
          `/draft/${leagueId}`,
        ],
      );

      await drainNotifications();
      return { notified: inserted.rowCount ?? 0, skipped: null };
    },
    () => ({ notified: 0, skipped: "Database is not configured." }),
  );
}
