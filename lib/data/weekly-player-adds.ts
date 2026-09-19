import type { PoolClient } from "pg";

/** Uses the persisted matchup window, including shortened weeks and playoffs.
 * No counter needs resetting and a delayed rollover job cannot extend a limit.
 * Call inside the team's advisory lock when enforcing an acquisition.
 */
export async function getWeeklyPlayerAdds(client: Pick<PoolClient, "query">, leagueId: string, teamId: string) {
  const result = await client.query<{ add_limit: number; used: string | number; resets_at: Date }>(
    `select coalesce((l.settings->>'weeklyPlayerAddLimit')::integer, 6) as add_limit, sp.ends_at as resets_at,
       (select count(*) from fantasy_transaction tx
        where tx.league_id = l.id and tx.team_id = $2
          and tx.status = 'processed' and tx.type in ('add', 'waiver')
          and not (coalesce(tx.payload, '{}'::jsonb) ? 'draftPick')
          and coalesce(tx.processed_at, tx.created_at) >= sp.starts_at
          and coalesce(tx.processed_at, tx.created_at) < sp.ends_at) as used
     from league l
     join scoring_period sp on sp.league_id = l.id
       and sp.starts_at <= now() and sp.ends_at > now()
     where l.id = $1 and l.scoring_type <> 'roto'
     order by sp.starts_at desc limit 1`,
    [leagueId, teamId],
  );
  const row = result.rows[0];
  return row ? { limit: Number(row.add_limit), used: Number(row.used), resetsAt: row.resets_at?.toISOString() ?? null } : null;
}
