import { getPool } from "../db/client";
import { chunk, mapWithConcurrency } from "./batching";
import { backfillPitcherSlotEligibility } from "./mlb-stats-sync";

// The MLB Stats API has no published rate limit but throttles aggressive
// clients; a small pool keeps the sync fast without hammering it.
const fetchConcurrency = 8;
// Rows per multi-row insert. Well under the 65,535-parameter limit at our
// column counts; mainly bounds statement size.
const writeChunkSize = 500;

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
  gameType?: string;
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
  // Timeout so a hung upstream request fails the sync instead of pinning a
  // pool connection (and its transaction) indefinitely.
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(30_000) });

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
    // Fetch everything up front: ~60 roster requests plus the schedule must
    // not run inside the write transaction, where a slow upstream would hold
    // row locks and a pool connection for the whole crawl.
    const teamsPayload = await fetchJson<MlbTeamsResponse>("/teams?sportId=1&activeStatus=Y", baseUrl);
    const teams = teamsPayload.teams ?? [];
    const rostersByTeam = new Map<number, MlbRosterResponse[]>();

    await mapWithConcurrency(teams, fetchConcurrency, async (team) => {
      const rosters: MlbRosterResponse[] = [];

      for (const rosterType of rosterTypes) {
        rosters.push(await fetchJson<MlbRosterResponse>(`/teams/${team.id}/roster?rosterType=${rosterType}`, baseUrl));
      }

      rostersByTeam.set(team.id, rosters);
    });

    const schedulePayload = await fetchSchedulePayload(baseUrl);

    await client.query("begin");

    rowsSeen += teams.length;
    if (teams.length) {
      await client.query(
        `insert into mlb_team (id, abbreviation, name, league, division)
         select * from unnest($1::integer[], $2::text[], $3::text[], $4::text[], $5::text[])
         on conflict (id) do update set
           abbreviation = excluded.abbreviation,
           name = excluded.name,
           league = excluded.league,
           division = excluded.division`,
        [
          teams.map((team) => team.id),
          teams.map((team) => team.abbreviation),
          teams.map((team) => team.name),
          teams.map((team) => team.league?.name ?? null),
          teams.map((team) => team.division?.name ?? null),
        ],
      );
    }

    // A player can appear on more than one roster (active + 40-man, or two
    // teams mid-trade); a multi-row upsert can't touch the same key twice, so
    // dedupe with the last occurrence winning like the sequential upserts did.
    const playerByMlbId = new Map<number, { fullName: string; teamId: number }>();
    const eligibilityByKey = new Map<string, { mlbPlayerId: number; position: string }>();

    for (const team of teams) {
      for (const rosterPayload of rostersByTeam.get(team.id) ?? []) {
        for (const rosterEntry of rosterPayload.roster ?? []) {
          rowsSeen += 1;
          const person = rosterEntry.person;
          const position = normalizePosition(rosterEntry.position?.abbreviation);

          if (!person?.id || !person.fullName) {
            continue;
          }

          playerByMlbId.set(person.id, { fullName: person.fullName, teamId: team.id });

          if (position) {
            eligibilityByKey.set(`${person.id}|${position}`, { mlbPlayerId: person.id, position });
          }
        }
      }
    }

    const idByMlbId = new Map<number, string>();
    for (const batch of chunk([...playerByMlbId.entries()], writeChunkSize)) {
      const result = await client.query<{ id: string; mlb_player_id: number }>(
        `insert into player (mlb_player_id, full_name, status, current_mlb_team_id)
         select t.mlb_player_id, t.full_name, 'active', t.team_id
         from unnest($1::integer[], $2::text[], $3::integer[]) as t(mlb_player_id, full_name, team_id)
         on conflict (mlb_player_id) do update set
           full_name = excluded.full_name,
           current_mlb_team_id = excluded.current_mlb_team_id,
           updated_at = now()
         returning id, mlb_player_id`,
        [
          batch.map(([mlbPlayerId]) => mlbPlayerId),
          batch.map(([, player]) => player.fullName),
          batch.map(([, player]) => player.teamId),
        ],
      );

      for (const row of result.rows) {
        idByMlbId.set(row.mlb_player_id, row.id);
      }
    }

    const eligibilityRows = [...eligibilityByKey.values()].flatMap(({ mlbPlayerId, position }) => {
      const playerId = idByMlbId.get(mlbPlayerId);
      return playerId ? [{ playerId, position }] : [];
    });

    for (const batch of chunk(eligibilityRows, writeChunkSize)) {
      await client.query(
        `insert into player_position_eligibility (player_id, position, source, valid_from)
         select t.player_id, t.position, 'mlb-stats-api', current_date
         from unnest($1::uuid[], $2::text[]) as t(player_id, position)
         on conflict (player_id, position, valid_from) do nothing`,
        [batch.map((row) => row.playerId), batch.map((row) => row.position)],
      );
    }

    const scheduleRowsSeen = await writeMlbSchedule(client, schedulePayload);
    rowsSeen += scheduleRowsSeen;

    // The roster feed labels every pitcher "P"; give each a fillable dedicated
    // slot (SP for probable starters, RP otherwise) now that probable pitchers
    // are known. The stats sync later refines this from real starts/relief use.
    await backfillPitcherSlotEligibility(client);

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
    // Record the failure so it shows as a failed run in the admin panel rather
    // than leaving the data silently stale. The 'started' row was inserted
    // before `begin`, so it survived the rollback and this update commits in
    // autocommit. Swallow a secondary failure here (e.g. a dead connection) so
    // the original error is what propagates and fails the sync.
    await client
      .query(
        `update ingestion_run
         set status = 'failed', finished_at = now(), rows_seen = $1, error_message = $2
         where id = $3`,
        [rowsSeen, error instanceof Error ? error.message : String(error), ingestionRunId],
      )
      .catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function fetchSchedulePayload(baseUrl = defaultBaseUrl) {
  const { startDate, endDate } = getDefaultScheduleWindow();

  return fetchJson<MlbScheduleResponse>(
    `/schedule?sportId=1&hydrate=probablePitcher&startDate=${startDate}&endDate=${endDate}`,
    baseUrl,
  );
}

export async function syncMlbSchedule(client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }, baseUrl = defaultBaseUrl) {
  return writeMlbSchedule(client, await fetchSchedulePayload(baseUrl));
}

// Regular season and postseason only. All-Star (A), exhibition (E), and
// spring (S) games involve pseudo-teams like the AL/NL All-Star squads
// (ids 159/160) that aren't in mlb_team, so writing them violates the
// team foreign keys — and they shouldn't drive lineup locks anyway.
const realGameTypes = new Set(["R", "F", "D", "L", "W"]);

async function writeMlbSchedule(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  schedulePayload: MlbScheduleResponse,
) {
  let rowsSeen = 0;
  // A postponed game can appear under two dates with the same gamePk; the
  // batched upsert can't touch a row twice, so keep the last occurrence.
  const gameByPk = new Map<number, MlbScheduleGame>();

  for (const scheduleDate of schedulePayload.dates ?? []) {
    for (const game of scheduleDate.games ?? []) {
      rowsSeen += 1;

      if (!game.gamePk || !game.gameDate || !game.gameType || !realGameTypes.has(game.gameType)) {
        continue;
      }

      gameByPk.set(game.gamePk, game);
    }
  }

  const games = [...gameByPk.values()];

  // Upsert probable pitchers first so game rows can reference their ids. A
  // pitcher can be probable for two starts in the window; keep the first
  // non-null team so the end state matches the old per-game coalesce upserts.
  const pitcherByMlbId = new Map<number, { fullName: string; teamId: number | null }>();
  for (const game of games) {
    for (const side of [game.teams?.away, game.teams?.home]) {
      const pitcher = side?.probablePitcher;
      if (!pitcher?.id || !pitcher.fullName) {
        continue;
      }
      const existing = pitcherByMlbId.get(pitcher.id);
      pitcherByMlbId.set(pitcher.id, {
        fullName: pitcher.fullName,
        teamId: existing?.teamId ?? side?.team?.id ?? null,
      });
    }
  }

  const pitcherIdByMlbId = new Map<number, string>();
  for (const batch of chunk([...pitcherByMlbId.entries()], writeChunkSize)) {
    const result = await client.query(
      `insert into player (mlb_player_id, full_name, status, current_mlb_team_id)
       select t.mlb_player_id, t.full_name, 'active', t.team_id
       from unnest($1::integer[], $2::text[], $3::integer[]) as t(mlb_player_id, full_name, team_id)
       on conflict (mlb_player_id) do update set
         full_name = excluded.full_name,
         current_mlb_team_id = coalesce(player.current_mlb_team_id, excluded.current_mlb_team_id),
         updated_at = now()
       returning id, mlb_player_id`,
      [
        batch.map(([mlbPlayerId]) => mlbPlayerId),
        batch.map(([, pitcher]) => pitcher.fullName),
        batch.map(([, pitcher]) => pitcher.teamId),
      ],
    );

    for (const row of getRows<{ id: string; mlb_player_id: number }>(result)) {
      pitcherIdByMlbId.set(row.mlb_player_id, row.id);
    }
  }

  const probablePitcherId = (side: MlbScheduleTeam | undefined) =>
    side?.probablePitcher?.id != null ? (pitcherIdByMlbId.get(side.probablePitcher.id) ?? null) : null;

  for (const batch of chunk(games, writeChunkSize)) {
    await client.query(
      `insert into mlb_game (
         game_pk, game_date, official_date, status, detailed_state, abstract_game_state,
         home_mlb_team_id, away_mlb_team_id, home_probable_pitcher_player_id,
         away_probable_pitcher_player_id, venue_name
       )
       select * from unnest(
         $1::integer[], $2::timestamptz[], $3::date[], $4::text[], $5::text[], $6::text[],
         $7::integer[], $8::integer[], $9::uuid[], $10::uuid[], $11::text[]
       )
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
        batch.map((game) => game.gamePk),
        batch.map((game) => game.gameDate),
        batch.map((game) => game.officialDate ?? null),
        batch.map((game) => game.status?.abstractGameState ?? null),
        batch.map((game) => game.status?.detailedState ?? null),
        batch.map((game) => game.status?.abstractGameState ?? null),
        batch.map((game) => game.teams?.home?.team?.id ?? null),
        batch.map((game) => game.teams?.away?.team?.id ?? null),
        batch.map((game) => probablePitcherId(game.teams?.home)),
        batch.map((game) => probablePitcherId(game.teams?.away)),
        batch.map((game) => game.venue?.name ?? null),
      ],
    );
  }

  return rowsSeen;
}

function getRows<T>(result: unknown): T[] {
  if (typeof result === "object" && result && "rows" in result) {
    return (result as { rows?: T[] }).rows ?? [];
  }

  return [];
}
