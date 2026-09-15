import { query } from "@/lib/db/client";

export type AccountStatus = {
  deactivated_at: Date | string | null;
  sessions_valid_after: Date | string | null;
};

export function acceptsSession(account: AccountStatus, createdAt?: Date | string) {
  if (account.deactivated_at !== null) return false;
  if (account.sessions_valid_after === null) return true;
  return Boolean(createdAt && new Date(createdAt).getTime() > new Date(account.sessions_valid_after).getTime());
}

// Resolve both identifiers: changing the provider email must not bypass a block.
// Errors intentionally propagate; an unavailable status must never grant access.
export async function isAccountBlocked(email: string, providerSubject = "") {
  const result = await query<{ blocked: boolean }>(`select exists (
    select 1 from app_user u where u.deactivated_at is not null and
      (lower(u.email) = lower($1) or exists (select 1 from auth_identity i
        where i.user_id = u.id and i.provider = 'neon-auth' and i.provider_subject = $2))
    ) as blocked`, [email.trim(), providerSubject]);
  return result.rows[0]?.blocked !== false;
}
