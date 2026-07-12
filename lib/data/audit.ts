import { isDatabaseConfigured, query } from "@/lib/db/client";
import type { AuditEventRecord, AuditListFilters } from "@/lib/data/audit-schema";

type AuditRow = {
  id: string;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  league_id: string | null;
  team_id: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
};

export type AuditEventInput = {
  /** Dotted action name, e.g. "player.add", "trade.propose", "admin.sync_mlb". */
  action: string;
  /** Who acted; omit for anonymous actions (e.g. signed-out feedback). */
  actor?: { userId?: string | null; email?: string | null } | null;
  entityType?: string;
  entityId?: string;
  leagueId?: string;
  teamId?: string;
  /** Action-specific context. Keep it small and free of secrets. */
  detail?: Record<string, unknown>;
  /** Source request, for IP and user-agent attribution. */
  request?: Request;
};

/** First X-Forwarded-For hop — the client IP on Vercel and most proxies. */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : null;
}

/**
 * Append one audit event. Fire-and-forget by design: auditing must never
 * break or slow the action it records, so failures log and are swallowed.
 * Callers may `void recordAuditEvent(...)` without awaiting.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await query(
      `insert into audit_log (actor_user_id, actor_email, action, entity_type, entity_id, league_id, team_id, detail, ip, user_agent)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        input.actor?.userId ?? null,
        input.actor?.email ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.leagueId ?? null,
        input.teamId ?? null,
        JSON.stringify(input.detail ?? {}),
        input.request ? clientIp(input.request) : null,
        input.request?.headers.get("user-agent") ?? null,
      ],
    );
  } catch (error) {
    console.error("Audit event could not be recorded.", input.action, error);
  }
}

const MAX_PAGE = 200;

/** Newest-first audit page for the admin viewer; `before` cursors older pages. */
export async function listAuditEvents(filters: AuditListFilters = {}): Promise<AuditEventRecord[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filters.action) {
    values.push(`${filters.action}%`);
    conditions.push(`action like $${values.length}`);
  }

  if (filters.actorEmail) {
    values.push(`%${filters.actorEmail}%`);
    conditions.push(`actor_email ilike $${values.length}`);
  }

  if (filters.before) {
    values.push(filters.before);
    conditions.push(`occurred_at < $${values.length}`);
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), MAX_PAGE);
  values.push(limit);

  const result = await query<AuditRow>(
    `select id, occurred_at, actor_user_id, actor_email, action, entity_type, entity_id, league_id, team_id, detail, ip, user_agent
     from audit_log
     ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
     order by occurred_at desc, id desc
     limit $${values.length}`,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    occurredAt: new Date(row.occurred_at).toISOString(),
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    leagueId: row.league_id,
    teamId: row.team_id,
    detail: row.detail ?? {},
    ip: row.ip,
    userAgent: row.user_agent,
  }));
}
