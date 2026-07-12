import type { Pool, PoolClient } from "pg";
import { getPool, tryDatabase } from "@/lib/db/client";
import { sendPushToUser } from "./push-subscriptions";

// Accepts either a pooled client (so a producer can enqueue inside its own
// transaction) or the pool itself.
type Queryable = Pick<Pool | PoolClient, "query">;

export type NotificationType = "waiver_result" | "draft_on_clock" | "draft_scheduled" | "trade_review" | "injury";

export type NotificationContent = {
  type: NotificationType;
  title: string;
  body: string;
  url?: string;
};

/**
 * Build the push payload for a resolved waiver claim. Pure so the copy is
 * unit-tested without a database.
 */
export function buildWaiverNotification(
  outcome: "won" | "lost",
  playerName: string,
  leagueId: string,
): NotificationContent {
  if (outcome === "won") {
    return {
      type: "waiver_result",
      title: "Waiver claim won",
      body: `You won ${playerName} off waivers.`,
      url: `/league/${leagueId}`,
    };
  }

  return {
    type: "waiver_result",
    title: "Waiver claim lost",
    body: `Your waiver claim for ${playerName} didn't go through.`,
    url: `/league/${leagueId}`,
  };
}

/**
 * Enqueue a notification for a team's (human) manager. Resolves the manager
 * from the team and skips bot teams. Runs on the caller's client so it commits
 * atomically with the domain change that produced it.
 */
export async function enqueueNotificationForTeam(
  db: Queryable,
  teamId: string,
  content: NotificationContent,
): Promise<void> {
  await db.query(
    `insert into notification_outbox (user_id, type, title, body, url)
     select ft.manager_user_id, $2, $3, $4, $5
     from fantasy_team ft
     where ft.id = $1 and ft.is_bot = false`,
    [teamId, content.type, content.title, content.body, content.url ?? null],
  );
}

export type DrainNotificationsResult = {
  sent: number;
  failed: number;
  skipped: number;
};

type PendingRow = {
  id: string;
  email: string;
  type: NotificationType;
  title: string;
  body: string;
  url: string | null;
};

/**
 * Deliver pending notifications via Web Push, marking each sent/failed. A user
 * with no active subscriptions is a successful no-op (delivered to zero
 * devices). Bounded per drain so one run can't spin forever.
 */
export async function drainNotifications(limit = 200): Promise<DrainNotificationsResult> {
  return tryDatabase(
    async () => {
      const pool = getPool();
      const pending = await pool.query<PendingRow>(
        `select n.id, u.email, n.type, n.title, n.body, n.url
         from notification_outbox n
         join app_user u on u.id = n.user_id
         where n.status = 'pending'
         order by n.created_at
         limit $1`,
        [limit],
      );

      const result: DrainNotificationsResult = { sent: 0, failed: 0, skipped: 0 };

      for (const row of pending.rows) {
        try {
          const delivery = await sendPushToUser(row.email, {
            title: row.title,
            body: row.body,
            url: row.url ?? undefined,
            tag: row.type,
          });
          await pool.query(
            `update notification_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = $1`,
            [row.id],
          );
          result.sent += 1;
          void delivery;
        } catch (error) {
          await pool.query(
            `update notification_outbox set status = 'failed', attempts = attempts + 1, last_error = $2 where id = $1`,
            [row.id, error instanceof Error ? error.message.slice(0, 500) : String(error)],
          );
          result.failed += 1;
        }
      }

      return result;
    },
    () => ({ sent: 0, failed: 0, skipped: 0 }),
  );
}
