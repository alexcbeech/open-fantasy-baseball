import { z } from "zod";
import { query, tryDatabase } from "@/lib/db/client";
import { demoUserEmail } from "@/lib/data/profile";
import { isWebPushConfigured, sendWebPush, type WebPushPayload } from "@/lib/notifications/web-push";

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().trim().url("A push endpoint URL is required.").max(1000),
  keys: z.object({
    p256dh: z.string().trim().min(1, "The p256dh key is required."),
    auth: z.string().trim().min(1, "The auth secret is required."),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().trim().url("A push endpoint URL is required.").max(1000),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

type PushSubscriptionRow = {
  endpoint: string;
  p256dh_key: string;
  auth_secret: string;
};

export type SavePushSubscriptionResult = {
  saved: boolean;
  activeCount: number;
};

async function activeCountForEmail(email: string): Promise<number> {
  const result = await query<{ count: string }>(
    `select count(*)::text as count
     from push_subscription s
     join app_user u on u.id = s.user_id
     where u.email = $1 and s.revoked_at is null`,
    [email],
  );

  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

export async function countActivePushSubscriptions(email = demoUserEmail): Promise<number> {
  return tryDatabase(
    () => activeCountForEmail(email),
    () => 0,
  );
}

export async function savePushSubscription(
  input: PushSubscriptionInput,
  email = demoUserEmail,
  userAgent: string | null = null,
): Promise<SavePushSubscriptionResult> {
  return tryDatabase<SavePushSubscriptionResult>(
    async () => {
      const userResult = await query<{ id: string }>(`select id from app_user where email = $1 limit 1`, [email]);
      const userId = userResult.rows[0]?.id;

      if (!userId) {
        return { saved: false, activeCount: 0 };
      }

      // Re-subscribing with the same endpoint refreshes keys and clears any prior
      // revocation so a re-enable does not create a duplicate row.
      await query(
        `insert into push_subscription (user_id, endpoint, p256dh_key, auth_secret, user_agent, revoked_at)
         values ($1, $2, $3, $4, $5, null)
         on conflict (endpoint) do update set
           user_id = excluded.user_id,
           p256dh_key = excluded.p256dh_key,
           auth_secret = excluded.auth_secret,
           user_agent = excluded.user_agent,
           revoked_at = null`,
        [userId, input.endpoint, input.keys.p256dh, input.keys.auth, userAgent],
      );

      return { saved: true, activeCount: await activeCountForEmail(email) };
    },
    () => ({ saved: false, activeCount: 0 }),
  );
}

export async function removePushSubscription(endpoint: string, email = demoUserEmail): Promise<SavePushSubscriptionResult> {
  return tryDatabase<SavePushSubscriptionResult>(
    async () => {
      await query(
        `update push_subscription s
         set revoked_at = now()
         from app_user u
         where s.user_id = u.id and u.email = $1 and s.endpoint = $2 and s.revoked_at is null`,
        [email, endpoint],
      );

      return { saved: true, activeCount: await activeCountForEmail(email) };
    },
    () => ({ saved: false, activeCount: 0 }),
  );
}

export type PushDeliverySummary = {
  configured: boolean;
  sent: number;
  failed: number;
  pruned: number;
};

/**
 * Fan a payload out to every active subscription for a user. Endpoints the push
 * service reports as gone (404/410) are revoked so the roster self-heals.
 */
export async function sendPushToUser(email: string, payload: WebPushPayload): Promise<PushDeliverySummary> {
  if (!isWebPushConfigured()) {
    return { configured: false, sent: 0, failed: 0, pruned: 0 };
  }

  return tryDatabase(
    async () => {
      const result = await query<PushSubscriptionRow>(
        `select s.endpoint, s.p256dh_key, s.auth_secret
         from push_subscription s
         join app_user u on u.id = s.user_id
         where u.email = $1 and s.revoked_at is null`,
        [email],
      );

      let sent = 0;
      let failed = 0;
      const goneEndpoints: string[] = [];

      for (const row of result.rows) {
        const outcome = await sendWebPush(
          { endpoint: row.endpoint, p256dhKey: row.p256dh_key, authSecret: row.auth_secret },
          payload,
        );

        if (outcome.ok) {
          sent += 1;
        } else {
          failed += 1;
          if (outcome.gone) {
            goneEndpoints.push(row.endpoint);
          }
        }
      }

      if (goneEndpoints.length) {
        await query(`update push_subscription set revoked_at = now() where endpoint = any($1::text[])`, [goneEndpoints]);
      }

      return { configured: true, sent, failed, pruned: goneEndpoints.length };
    },
    () => ({ configured: true, sent: 0, failed: 0, pruned: 0 }),
  );
}
