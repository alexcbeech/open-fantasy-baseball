import { getPool } from "../db/client";

export type ProbableStart = {
  gameDate: string;
  opponentAbbrev: string | null;
};

export type PlayerNewsContext = {
  playerId: string;
  fullName: string;
  status: string;
  teamAbbrev: string | null;
  probableStart: ProbableStart | null;
};

export type PlayerNewsDraft = {
  playerId: string;
  headline: string;
  summary: string | null;
  publishedAt: string;
};

/**
 * A news provider turns what OFB knows about a player into publishable news
 * items. The default provider synthesizes items from roster status and probable
 * starter data OFB already ingests; a real wire feed (RotoWire, etc.) can
 * implement the same interface later without changing the ingestion flow.
 */
export interface PlayerNewsProvider {
  readonly source: string;
  generate(contexts: PlayerNewsContext[], now: Date): Promise<PlayerNewsDraft[]> | PlayerNewsDraft[];
}

const STATUS_HEADLINES: Record<string, { headline: (name: string) => string; summary: string }> = {
  injured: {
    headline: (name) => `${name} placed on the injured list`,
    summary: "Rostered managers should line up a replacement until the injured list stint resolves.",
  },
  "day-to-day": {
    headline: (name) => `${name} listed as day-to-day`,
    summary: "Monitor the lineup card before lock; the status could change at short notice.",
  },
  minors: {
    headline: (name) => `${name} optioned to the minor leagues`,
    summary: "Consider a bench or NA slot while the player is off the active roster.",
  },
};

function startOfDayIso(date: string) {
  // Normalize a YYYY-MM-DD (or ISO) date to a stable midnight-UTC timestamp so
  // repeated syncs produce identical published_at values and dedupe cleanly.
  return new Date(`${date.slice(0, 10)}T00:00:00.000Z`).toISOString();
}

/**
 * Produce zero or more news drafts for a single player from their current
 * status and next probable start. Pure and deterministic for a given `now`.
 */
export function deriveNewsDrafts(context: PlayerNewsContext, now: Date): PlayerNewsDraft[] {
  const drafts: PlayerNewsDraft[] = [];
  const statusEntry = STATUS_HEADLINES[context.status];

  if (statusEntry) {
    drafts.push({
      playerId: context.playerId,
      headline: statusEntry.headline(context.fullName),
      summary: statusEntry.summary,
      publishedAt: now.toISOString(),
    });
  }

  if (context.probableStart) {
    const opponent = context.probableStart.opponentAbbrev ? ` vs ${context.probableStart.opponentAbbrev}` : "";
    const dateLabel = context.probableStart.gameDate.slice(0, 10);
    drafts.push({
      playerId: context.playerId,
      headline: `${context.fullName} probable to start${opponent} on ${dateLabel}`,
      summary: "Confirmed as a probable starter; stream-eligible in daily-move leagues.",
      publishedAt: startOfDayIso(context.probableStart.gameDate),
    });
  }

  return drafts;
}

export class StatusAndScheduleNewsProvider implements PlayerNewsProvider {
  readonly source = "ofb-signals";

  generate(contexts: PlayerNewsContext[], now: Date): PlayerNewsDraft[] {
    return contexts.flatMap((context) => deriveNewsDrafts(context, now));
  }
}

type NewsSourceRow = {
  player_id: string;
  full_name: string;
  status: string;
  team_abbrev: string | null;
  game_date: Date | string | null;
  opponent_abbrev: string | null;
};

export type SyncPlayerNewsResult = {
  ingestionRunId: string;
  rowsSeen: number;
  rowsWritten: number;
  status: "succeeded";
  source: string;
};

/**
 * Synthesize player news from current roster status and probable-starter
 * schedule data, persisting new items to player_news (deduped on
 * player/headline/published_at) with an ingestion_run audit row.
 */
export async function syncPlayerNews(
  provider: PlayerNewsProvider = new StatusAndScheduleNewsProvider(),
  today = new Date(),
): Promise<SyncPlayerNewsResult> {
  const pool = getPool();
  const client = await pool.connect();
  const ingestion = await client.query<{ id: string }>(
    `insert into ingestion_run (source, job_type, status)
     values ($1, 'player-news', 'started')
     returning id`,
    [provider.source],
  );
  const ingestionRunId = ingestion.rows[0].id;
  const fromDate = today.toISOString().slice(0, 10);
  let rowsSeen = 0;
  let rowsWritten = 0;

  try {
    const sources = await client.query<NewsSourceRow>(
      `select
         p.id as player_id,
         p.full_name,
         p.status,
         mt.abbreviation as team_abbrev,
         ps.game_date,
         opp.abbreviation as opponent_abbrev
       from player p
       left join mlb_team mt on mt.id = p.current_mlb_team_id
       left join lateral (
         select
           g.game_date,
           case when g.home_probable_pitcher_player_id = p.id then g.away_mlb_team_id else g.home_mlb_team_id end as opponent_team_id
         from mlb_game g
         where (g.home_probable_pitcher_player_id = p.id or g.away_probable_pitcher_player_id = p.id)
           and g.game_date >= $1::date
         order by g.game_date asc
         limit 1
       ) ps on true
       left join mlb_team opp on opp.id = ps.opponent_team_id
       where p.status in ('injured', 'day-to-day', 'minors') or ps.game_date is not null`,
      [fromDate],
    );

    const contexts: PlayerNewsContext[] = sources.rows.map((row) => {
      rowsSeen += 1;
      return {
        playerId: row.player_id,
        fullName: row.full_name,
        status: row.status,
        teamAbbrev: row.team_abbrev,
        probableStart: row.game_date
          ? {
              gameDate: row.game_date instanceof Date ? row.game_date.toISOString() : String(row.game_date),
              opponentAbbrev: row.opponent_abbrev,
            }
          : null,
      };
    });

    const drafts = await provider.generate(contexts, today);

    await client.query("begin");

    for (const draft of drafts) {
      const inserted = await client.query(
        `insert into player_news (player_id, source, headline, summary, published_at)
         select $1, $2, $3, $4, $5
         where not exists (
           select 1 from player_news
           where player_id = $1 and headline = $3 and published_at = $5
         )`,
        [draft.playerId, provider.source, draft.headline, draft.summary, draft.publishedAt],
      );
      rowsWritten += inserted.rowCount ?? 0;
    }

    await client.query(
      `update ingestion_run set status = 'succeeded', finished_at = now(), rows_seen = $1 where id = $2`,
      [rowsSeen, ingestionRunId],
    );
    await client.query("commit");

    return { ingestionRunId, rowsSeen, rowsWritten, status: "succeeded", source: provider.source };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await client.query(
      `update ingestion_run set status = 'failed', finished_at = now(), rows_seen = $1, error_message = $2 where id = $3`,
      [rowsSeen, error instanceof Error ? error.message : String(error), ingestionRunId],
    );
    throw error;
  } finally {
    client.release();
  }
}
