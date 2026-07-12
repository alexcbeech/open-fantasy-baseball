// Pure audit types shared by server code and the admin client component.
// No database imports here (see client-component DB import gotcha).

export type AuditEventRecord = {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  leagueId: string | null;
  teamId: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
};

export type AuditListFilters = {
  /** Exact action or action prefix, e.g. "player." matches player.add. */
  action?: string;
  /** Case-insensitive substring match on the actor email. */
  actorEmail?: string;
  /** Return events strictly older than this ISO timestamp (cursor). */
  before?: string;
  limit?: number;
};
