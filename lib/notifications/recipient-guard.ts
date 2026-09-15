import { getPool, isDatabaseConfigured } from "@/lib/db/client";
import { acceptsSession, type AccountStatus } from "@/lib/auth/account-status";

export class DeliverySuppressed extends Error {
  constructor() { super("Delivery canceled because this account was deactivated."); }
}

/** Serialize a delivery with deactivation. Once deactivation commits, no new
 * provider handoff can begin. Queued messages also stay canceled on reactivation.
 * Unknown addresses remain eligible (league invitations / anonymous feedback).
 */
export async function withEligibleRecipient<T>(email: string, deliver: () => Promise<T>, createdAt?: string | Date): Promise<T> {
  if (!isDatabaseConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("Recipient status is unavailable.");
    return deliver();
  }
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock_shared(hashtextextended(lower($1), 36))", [email.trim()]);
    const result = await client.query<AccountStatus>(
      "select deactivated_at, sessions_valid_after from app_user where lower(email) = lower($1)", [email.trim()]);
    if (result.rows.some(account => !acceptsSession(account, createdAt ?? new Date()))) throw new DeliverySuppressed();
    const delivery = await deliver();
    await client.query("commit");
    return delivery;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
