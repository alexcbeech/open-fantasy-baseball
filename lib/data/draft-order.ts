import type { PoolClient } from "pg";

/**
 * Append one team to an existing setup draft. Locking the draft row serializes
 * position assignment when multiple invitees accept at nearly the same time.
 * Leagues without a configured draft are a no-op; setup will order every team
 * when the commissioner creates it later.
 */
export async function appendTeamToSetupDraft(client: PoolClient, leagueId: string, teamId: string): Promise<void> {
  const draft = await client.query<{ id: string }>(
    `select id from draft where league_id = $1 and status = 'setup' for update`,
    [leagueId],
  );
  const draftId = draft.rows[0]?.id;

  if (!draftId) {
    return;
  }

  const position = await client.query<{ next_position: number | string }>(
    `select coalesce(max(position), 0) + 1 as next_position from draft_order where draft_id = $1`,
    [draftId],
  );

  await client.query(
    `insert into draft_order (draft_id, position, team_id)
     values ($1, $2, $3)
     on conflict (draft_id, team_id) do nothing`,
    [draftId, Number(position.rows[0].next_position), teamId],
  );
}

/** Repair any league teams omitted from a setup draft, preserving join order. */
export async function reconcileSetupDraftOrder(
  client: PoolClient,
  draftId: string,
  leagueId: string,
): Promise<void> {
  const missing = await client.query<{ id: string }>(
    `select ft.id
     from fantasy_team ft
     left join draft_order dor on dor.draft_id = $1 and dor.team_id = ft.id
     where ft.league_id = $2 and dor.team_id is null
     order by ft.created_at, ft.id`,
    [draftId, leagueId],
  );

  if (!missing.rows.length) {
    return;
  }

  const position = await client.query<{ max_position: number | string }>(
    `select coalesce(max(position), 0) as max_position from draft_order where draft_id = $1`,
    [draftId],
  );
  const maxPosition = Number(position.rows[0].max_position);

  for (const [index, team] of missing.rows.entries()) {
    await client.query(
      `insert into draft_order (draft_id, position, team_id)
       values ($1, $2, $3)
       on conflict (draft_id, team_id) do nothing`,
      [draftId, maxPosition + index + 1, team.id],
    );
  }
}
