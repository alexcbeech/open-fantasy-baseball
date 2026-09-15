import { getPool, isDatabaseConfigured, query } from "@/lib/db/client";
import { getNeonAuth, type OfbCurrentUser } from "@/lib/auth/neon-auth";
import type { AccountCommand, AdminUser } from "./admin-user-schema";

export class AccountChangeError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export async function listAdminUsers(search = "") {
  if (!isDatabaseConfigured()) return [];
  return (await query<AdminUser>(`select u.id, u.email, u.display_name as "displayName",
    u.deactivated_at::text as "deactivatedAt", actor.email as "deactivatedBy",
    u.deactivation_reason as reason, u.account_revision as revision, u.auth_sync_pending as "authSyncPending"
    from app_user u left join app_user actor on actor.id = u.deactivated_by
    where strpos(lower(u.email || ' ' || u.display_name), lower($1)) > 0
    order by u.email, u.id limit 100`, [search])).rows;
}

/** App status is authoritative; provider failures are visible and retryable. A global
 * transaction lock serializes administrators, including opposite concurrent
 * requests. Self-deactivation is forbidden, preserving an active administrator.
 */
export async function changeAccount(command: AccountCommand, actor: OfbCurrentUser, request: Request) {
  if (!actor.isAdmin) throw new AccountChangeError("Admin access is required.", 403);
  if (command.userId === actor.userId) throw new AccountChangeError("You cannot deactivate or change your own account. Another active administrator must do this.");
  const client = await getPool().connect();
  let syncPending = false;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(360036)");
    const administrator = (await client.query(`select id from app_user where id::text = $1 and deactivated_at is null`, [actor.userId])).rows[0];
    if (!administrator) throw new AccountChangeError("Your administrator account is no longer active.", 403);
    const target = (await client.query<{ email: string; deactivated_at: Date | null; account_revision: number; auth_sync_pending: boolean }>(
      "select email, deactivated_at, account_revision, auth_sync_pending from app_user where id = $1", [command.userId])).rows[0];
    if (!target) throw new AccountChangeError("User was not found.", 404);
    if (target.account_revision !== command.revision) throw new AccountChangeError("This account changed. Reload users before continuing.");
    if (command.action === "deactivate" && target.deactivated_at) throw new AccountChangeError("This account is already deactivated.");
    if (command.action === "reactivate" && !target.deactivated_at) throw new AccountChangeError("This account is already active.");
    if (command.action === "retry-auth" && (!target.deactivated_at || !target.auth_sync_pending)) throw new AccountChangeError("There is no pending authentication change.");
    await client.query("select pg_advisory_xact_lock(hashtextextended(lower($1), 36))", [target.email]);
    const identities = (await client.query<{ provider_subject: string }>(
      "select provider_subject from auth_identity where user_id = $1 and provider = 'neon-auth'", [command.userId])).rows;
    const auth = getNeonAuth();
    const reactivate = command.action === "reactivate";
    // Local writes and the audit are atomic. Provider failure on deactivation
    // still commits the block; reactivation fails closed until it synchronizes.
    for (const identity of identities) {
      try {
        if (!auth) throw new Error("Authentication is not configured.");
        const userId = identity.provider_subject;
        const revoked = await auth.admin.revokeUserSessions({ userId });
        if (revoked.error) throw new Error("Session revocation failed.");
        const result = reactivate ? await auth.admin.unbanUser({ userId }) : await auth.admin.banUser({ userId, banReason: "Account deactivated by an OFB administrator." });
        if (result.error) throw new Error("Authentication update failed.");
      } catch {
        if (reactivate) throw new AccountChangeError("Authentication could not be synchronized. The account remains deactivated; try again shortly.", 503);
        syncPending = true;
      }
    }
    await client.query(`update app_user set
      deactivated_at = case when $2 then null else coalesce(deactivated_at, clock_timestamp()) end,
      deactivated_by = case when $3 = 'deactivate' then $4::uuid else deactivated_by end,
      deactivation_reason = case when $3 = 'deactivate' then $5 else deactivation_reason end,
      sessions_valid_after = clock_timestamp(), auth_sync_pending = $6,
      account_revision = account_revision + 1, updated_at = clock_timestamp() where id = $1`,
    [command.userId, reactivate, command.action, actor.userId, command.reason || null, syncPending]);
    if (!reactivate) {
      await client.query("update oauth_access_token set revoked_at = coalesce(revoked_at, now()) where user_id = $1", [command.userId]);
      await client.query("update oauth_client set revoked_at = coalesce(revoked_at, now()) where owner_user_id = $1", [command.userId]);
      await client.query("update push_subscription set revoked_at = coalesce(revoked_at, now()) where user_id = $1", [command.userId]);
      await client.query("update notification_outbox set status = 'skipped', last_error = 'Account deactivated' where user_id = $1 and status in ('pending', 'failed')", [command.userId]);
      await client.query("update admin_announcement_recipient set status = 'blocked' where lower(email) = lower($1) and status <> 'accepted'", [target.email]);
      await client.query("update feedback_reply set status = 'canceled', error = 'Account deactivated', updated_at = now() where lower(recipient) = lower($1) and status <> 'sent'", [target.email]);
    }
    await client.query(`insert into audit_log(actor_user_id, actor_email, action, entity_type, entity_id, detail, ip, user_agent)
      values ($1, $2, $3, 'app_user', $4, $5::jsonb, $6, $7)`,
    [actor.userId, actor.email, `user.${command.action}`, command.userId,
      JSON.stringify({ reason: command.reason || null, authSyncPending: syncPending }),
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null, request.headers.get("user-agent")]);
    await client.query("commit");
    return { authSyncPending: syncPending };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
