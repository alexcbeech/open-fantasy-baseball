import { getPool } from "../db/client";

type MlbTeam = {
  id: number;
  abbreviation: string;
  name: string;
  league?: { name?: string };
  division?: { name?: string };
};

type MlbRosterEntry = {
  person?: {
    id?: number;
    fullName?: string;
  };
  position?: {
    abbreviation?: string;
  };
};

type MlbTeamsResponse = {
  teams?: MlbTeam[];
};

type MlbRosterResponse = {
  roster?: MlbRosterEntry[];
};

type MlbScheduleResponse = {
  dates?: Array<{
    games?: MlbScheduleGame[];
  }>;
};

type MlbScheduleGame = {
  gamePk?: number;
  gameDate?: string;
  officialDate?: string;
  status?: {
    abstractGameState?: string;
    detailedState?: string;
  };
  teams?: {
    away?: MlbScheduleTeam;
    home?: MlbScheduleTeam;
  };
  venue?: {
    name?: string;
  };
};

type MlbScheduleTeam = {
  team?: {
    id?: number;
  };
  probablePitcher?: {
    id?: number;
    fullName?: string;
  };
};

const defaultBaseUrl = process.env.MLB_STATS_API_BASE_URL ?? "https://statsapi.mlb.com/api/v1";
const rosterTypes = ["active", "40Man"] as const;

async function fetchJson<T>(path: string, baseUrl = defaultBaseUrl): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`);

  if (!response.ok) {
    throw new Error(`MLB Stats API request failed: ${response.status} ${response.statusText} ${path}`);
  }

  return response.json() as Promise<T>;
}

function normalizePosition(position?: string) {
  if (!position) {
    return undefined;
  }

  if (["P", "SP", "RP", "C", "1B", "2B", "3B", "SS", "OF"].includes(position)) {
    return position;
  }

  if (["LF", "CF", "RF"].includes(position)) {
    return "OF";
  }

  return undefined;
}

function toMlbDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function getDefaultScheduleWindow(today = new Date()) {
  return {
    startDate: toMlbDate(addDays(today, -1)),
    endDate: toMlbDate(addDays(today, 7)),
  };
}

export async function syncMlbTeamsAndRosters(baseUrl = defaultBaseUrl) {
  const pool = getPool();
  const client = await pool.connect();
  const ingestion = await client.query<{ id: string }>(
    `insert into ingestion_run (source, job_type, status)
     values ('mlb-stats-api', 'teams-rosters', 'started')
     returning id`,
  );
  const ingestionRunId = ingestion.rows[0].id;
  let rowsSeen = 0;

  try {
    const teamsPayload = await fetchJson<MlbTeamsResponse>("/teams?sportId=1&activeStatus=Y", baseUrl);
    await client.query("begin");

    for (const team of teamsPayload.teams ?? []) {
      rowsSeen += 1;
      await client.query(
        `insert into mlb_team (id, abbreviation, name, league, division)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update set
           abbreviation = excluded.abbreviation,
           name = excluded.name,
           league = excluded.league,
           division = excluded.division`,
        [team.id, team.abbreviation, team.name, team.league?.name, team.division?.name],
      );

      for (const rosterType of rosterTypes) {
        const rosterPayload = await fetchJson<MlbRosterResponse>(`/teams/${team.id}/roster?rosterType=${rosterType}`, baseUrl);

        for (const rosterEntry of rosterPayload.roster ?? []) {
          rowsSeen += 1;
          const person = rosterEntry.person;
          const position = normalizePosition(rosterEntry.position?.abbreviation);

          if (!person?.id || !person.fullName) {
            continue;
          }

          const playerResult = await client.query<{ id: string }>(
            `insert into player (mlb_player_id, full_name, status, current_mlb_team_id)
             values ($1, $2, 'active', $3)
             on conflict (mlb_player_id) do update set
               full_name = excluded.full_name,
               current_mlb_team_id = excluded.current_mlb_team_id,
               updated_at = now()
             returning id`,
            [person.id, person.fullName, team.id],
          );

          if (position) {
            await client.query(
              `insert into player_position_eligibility (player_id, position, source, valid_from)
               values ($1, $2, 'mlb-stats-api', current_date)
               on conflict (player_id, position, valid_from) do nothing`,
              [playerResult.rows[0].id, position],
            );
          }
        }
      }
    }

    const scheduleRowsSeen = await syncMlbSchedule(client, baseUrl);
    rowsSeen += scheduleRowsSeen;

    await client.query(
      `update ingestion_run
       set status = 'succeeded', finished_at = now(), rows_seen = $1
       where id = $2`,
      [rowsSeen, ingestionRunId],
    );
    await client.query("commit");

    return {
      ingestionRunId,
      rowsSeen,
      scheduleRowsSeen,
      status: "succeeded" as const,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    await client.query(
      `update ingestion_run
       set status = 'failed', finished_at = now(), rows_seen = $1, error_message = $2
       where id = $3`,
      [rowsSeen, error instanceof Error ? error.message : String(error), ingestionRunId],
    );
    throw error;
  } finally {
    client.release();
  }
}

export async function syncMlbSchedule(client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }, baseUrl = defaultBaseUrl) {
  const { startDate, endDate } = getDefaultScheduleWindow();
  const schedulePayload = await fetchJson<MlbScheduleResponse>(
    `/schedule?sportId=1&hydrate=probablePitcher&startDate=${startDate}&endDate=${endDate}`,
    baseUrl,
  );
  let rowsSeen = 0;

  for (const scheduleDate of schedulePayload.dates ?? []) {
    for (const game of scheduleDate.games ?? []) {
      rowsSeen += 1;

      if (!game.gamePk || !game.gameDate) {
        continue;
      }

      const awayTeamId = game.teams?.away?.team?.id ?? null;
      const homeTeamId = game.teams?.home?.team?.id ?? null;
      const awayPitcherId = await upsertProbablePitcher(client, game.teams?.away?.probablePitcher, awayTeamId);
      const homePitcherId = await upsertProbablePitcher(client, game.teams?.home?.probablePitcher, homeTeamId);

      await client.query(
        `insert into mlb_game (
           game_pk, game_date, official_date, status, detailed_state, abstract_game_state,
           home_mlb_team_id, away_mlb_team_id, home_probable_pitcher_player_id,
           away_probable_pitcher_player_id, venue_name
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (game_pk) do update set
           game_date = excluded.game_date,
           official_date = excluded.official_date,
           status = excluded.status,
           detailed_state = excluded.detailed_state,
           abstract_game_state = excluded.abstract_game_state,
           home_mlb_team_id = excluded.home_mlb_team_id,
           away_mlb_team_id = excluded.away_mlb_team_id,
           home_probable_pitcher_player_id = excluded.home_probable_pitcher_player_id,
           away_probable_pitcher_player_id = excluded.away_probable_pitcher_player_id,
           venue_name = excluded.venue_name,
           updated_at = now()`,
        [
          game.gamePk,
          game.gameDate,
          game.officialDate ?? null,
          game.status?.abstractGameState ?? null,
          game.status?.detailedState ?? null,
          game.status?.abstractGameState ?? null,
          homeTeamId,
          awayTeamId,
          homePitcherId,
          awayPitcherId,
          game.venue?.name ?? null,
        ],
      );
    }
  }

  return rowsSeen;
}

async function upsertProbablePitcher(
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows?: Array<{ id: string }> } | unknown> },
  pitcher: MlbScheduleTeam["probablePitcher"] | undefined,
  teamId: number | null,
) {
  if (!pitcher?.id || !pitcher.fullName) {
    return null;
  }

  const result = await client.query(
    `insert into player (mlb_player_id, full_name, status, current_mlb_team_id)
     values ($1, $2, 'active', $3)
     on conflict (mlb_player_id) do update set
       full_name = excluded.full_name,
       current_mlb_team_id = coalesce(player.current_mlb_team_id, excluded.current_mlb_team_id),
       updated_at = now()
     returning id`,
    [pitcher.id, pitcher.fullName, teamId],
  );

  return getFirstRowId(result);
}

function getFirstRowId(result: { rows?: Array<{ id: string }> } | unknown) {
  if (typeof result === "object" && result && "rows" in result) {
    const rows = (result as { rows?: Array<{ id: string }> }).rows;
    return rows?.[0]?.id ?? null;
  }

  return null;
}
