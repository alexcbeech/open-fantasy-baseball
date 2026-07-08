import { query, tryDatabase } from "@/lib/db/client";
import { calculateFantasyPoints } from "@/lib/fantasy/scoring";
import type { LivePlayerStatus } from "@/lib/fantasy/types";
import { mapMlbStat } from "./mlb-stats-sync";

const defaultBaseUrl = process.env.MLB_STATS_API_BASE_URL ?? "https://statsapi.mlb.com/api/v1";

// Partial-game rate stats (AVG/ERA/WHIP) are noise mid-game, so they are dropped
// from the live line; the weighted counting stats and components are kept.
const RATE_KEYS = ["AVG", "ERA", "WHIP"];

const notLive: LivePlayerStatus = { live: false, state: null, stats: {}, points: null };

type ScheduleGame = {
  gamePk: number;
  status?: { abstractGameState?: string };
  teams?: {
    home?: { team?: { id?: number } };
    away?: { team?: { id?: number } };
  };
};
type ScheduleResponse = { dates?: Array<{ games?: ScheduleGame[] }> };

type BoxscorePlayer = {
  person?: { id?: number };
  stats?: { batting?: Record<string, unknown>; pitching?: Record<string, unknown> };
};
type BoxscoreTeam = { players?: Record<string, BoxscorePlayer> };
type BoxscoreResponse = { teams?: { home?: BoxscoreTeam; away?: BoxscoreTeam } };

type LinescoreResponse = { inningState?: string; currentInningOrdinal?: string };

async function fetchJson<T>(path: string, baseUrl: string): Promise<T | null> {
  try {
    // Timeout so a hung MLB request can't stall a user-facing route.
    const response = await fetch(`${baseUrl}${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// Live endpoints are polled every 30s by several routes, tabs, and users at
// once, all wanting the same handful of schedule/boxscore/linescore payloads.
// A short-TTL cache plus single-flight collapses that fanout to one upstream
// request per URL per TTL: concurrent callers share one in-flight promise, and
// callers within the TTL read the memoized value. The schedule tolerates a
// longer TTL (game states change slowly); boxscore/linescore stay fresher.
export const SCHEDULE_TTL_MS = 60_000;
export const GAME_TTL_MS = 15_000;

type CacheEntry = { value: unknown; expires: number };
const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

// Drop finished games' entries once they expire so the map does not accumulate
// large stale boxscores over a long-running server; the live set is small.
function pruneExpired(now: number) {
  for (const [key, entry] of responseCache) {
    if (entry.expires <= now) {
      responseCache.delete(key);
    }
  }
}

export async function cachedFetchJson<T>(path: string, baseUrl: string, ttlMs: number): Promise<T | null> {
  const key = `${baseUrl}${path}`;
  const now = Date.now();

  const cached = responseCache.get(key);
  if (cached && cached.expires > now) {
    return cached.value as T;
  }

  const existing = inFlight.get(key);
  if (existing) {
    return existing as Promise<T | null>;
  }

  const request = (async () => {
    const value = await fetchJson<T>(path, baseUrl);
    // Only memoize successful responses so a transient failure retries next call.
    if (value !== null) {
      pruneExpired(now);
      responseCache.set(key, { value, expires: Date.now() + ttlMs });
    }
    return value;
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

/** Test-only: clear the live response cache so cases don't leak into each other. */
export function __clearLiveCache() {
  responseCache.clear();
  inFlight.clear();
}

function todayIso(now: Date) {
  // MLB schedule dates are ET official dates: a 10pm ET game is already
  // "tomorrow" in UTC, so a UTC calendar day would go dark at 8pm ET.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** The gamePk of the team's in-progress game today, or null if none is live. */
async function findLiveGamePk(baseUrl: string, mlbTeamId: number, now: Date): Promise<number | null> {
  const schedule = await cachedFetchJson<ScheduleResponse>(
    `/schedule?sportId=1&teamId=${mlbTeamId}&date=${todayIso(now)}`,
    baseUrl,
    SCHEDULE_TTL_MS,
  );
  const games = schedule?.dates?.[0]?.games ?? [];
  const live = games.find((game) => game.status?.abstractGameState === "Live");
  return live?.gamePk ?? null;
}

/** The player's mapped stat line from an already-fetched boxscore. */
export function extractLine(box: BoxscoreResponse | null, mlbPlayerId: number): Record<string, number | string> {
  const key = `ID${mlbPlayerId}`;
  const entry = box?.teams?.home?.players?.[key] ?? box?.teams?.away?.players?.[key];
  if (!entry?.stats) {
    return {};
  }

  const stats = {
    ...mapMlbStat(entry.stats.batting, "hitting"),
    ...mapMlbStat(entry.stats.pitching, "pitching"),
  };
  for (const rateKey of RATE_KEYS) {
    delete stats[rateKey];
  }
  return stats;
}

/** The player's stat line so far in the given game, mapped to OFB categories. */
async function fetchLiveLine(baseUrl: string, gamePk: number, mlbPlayerId: number): Promise<Record<string, number | string>> {
  const box = await cachedFetchJson<BoxscoreResponse>(`/game/${gamePk}/boxscore`, baseUrl, GAME_TTL_MS);
  return extractLine(box, mlbPlayerId);
}

function livePoints(stats: Record<string, number | string>) {
  return Math.round(calculateFantasyPoints(stats) * 10) / 10;
}

/** A human inning label like "Bottom 7th" for the live game. */
async function fetchGameState(baseUrl: string, gamePk: number): Promise<string | null> {
  const line = await cachedFetchJson<LinescoreResponse>(`/game/${gamePk}/linescore`, baseUrl, GAME_TTL_MS);
  if (!line?.inningState || !line.currentInningOrdinal) {
    return "In Progress";
  }
  return `${line.inningState} ${line.currentInningOrdinal}`;
}

/**
 * On-demand live status for a single player: looks up their MLB id and team,
 * finds the team's in-progress game (if any) from the live MLB schedule, and
 * pulls their current boxscore line and live fantasy points. Returns a not-live
 * result whenever there is no game in progress, no database, or the MLB API is
 * unreachable, so callers can poll this cheaply while a detail view is open.
 */
export async function getLivePlayerStatus(playerId: string, baseUrl = defaultBaseUrl, now = new Date()): Promise<LivePlayerStatus> {
  return tryDatabase(
    async () => {
      const result = await query<{ mlb_player_id: number | null; current_mlb_team_id: number | null }>(
        `select mlb_player_id, current_mlb_team_id from player where id = $1`,
        [playerId],
      );
      const row = result.rows[0];
      if (!row?.mlb_player_id || !row.current_mlb_team_id) {
        return notLive;
      }

      const gamePk = await findLiveGamePk(baseUrl, row.current_mlb_team_id, now);
      if (!gamePk) {
        return notLive;
      }

      const [stats, state] = await Promise.all([
        fetchLiveLine(baseUrl, gamePk, row.mlb_player_id),
        fetchGameState(baseUrl, gamePk),
      ]);

      return {
        live: true,
        state,
        stats,
        points: livePoints(stats),
      };
    },
    () => notLive,
  );
}

/** A live line for one lineup player, keyed by OFB player id in the result map. */
export type LiveLineupEntry = { state: string | null; stats: Record<string, number | string>; points: number };

export type LivePlayerRef = { id: string; mlb_player_id: number; current_mlb_team_id: number };

/**
 * Live lines for an arbitrary set of players, keyed by player id. Fetches the
 * day's schedule once, then each in-progress game's boxscore/linescore once, and
 * distributes the lines to the players on those teams — so any number of players
 * costs a handful of MLB requests, not one per player. Only players whose game
 * is in progress appear in the map; everyone else is simply absent. Shared by
 * the team lineup overlay and the live matchup recalculation.
 */
export async function getLiveLinesForPlayers(
  players: LivePlayerRef[],
  baseUrl = defaultBaseUrl,
  now = new Date(),
): Promise<Record<string, LiveLineupEntry>> {
  if (!players.length) {
    return {};
  }

  const schedule = await cachedFetchJson<ScheduleResponse>(`/schedule?sportId=1&date=${todayIso(now)}`, baseUrl, SCHEDULE_TTL_MS);
  const games = schedule?.dates?.[0]?.games ?? [];
  const liveGameByTeam = new Map<number, number>();
  for (const game of games) {
    if (game.status?.abstractGameState !== "Live") {
      continue;
    }
    const home = game.teams?.home?.team?.id;
    const away = game.teams?.away?.team?.id;
    if (home) liveGameByTeam.set(home, game.gamePk);
    if (away) liveGameByTeam.set(away, game.gamePk);
  }

  // Only fetch boxscores for games that actually have one of these players in them.
  const neededGames = new Set<number>();
  for (const player of players) {
    const gamePk = liveGameByTeam.get(player.current_mlb_team_id);
    if (gamePk) {
      neededGames.add(gamePk);
    }
  }
  if (!neededGames.size) {
    return {};
  }

  const gameData = new Map<number, { box: BoxscoreResponse | null; state: string | null }>();
  await Promise.all(
    [...neededGames].map(async (gamePk) => {
      const [box, state] = await Promise.all([
        cachedFetchJson<BoxscoreResponse>(`/game/${gamePk}/boxscore`, baseUrl, GAME_TTL_MS),
        fetchGameState(baseUrl, gamePk),
      ]);
      gameData.set(gamePk, { box, state });
    }),
  );

  const result: Record<string, LiveLineupEntry> = {};
  for (const player of players) {
    const gamePk = liveGameByTeam.get(player.current_mlb_team_id);
    const data = gamePk ? gameData.get(gamePk) : undefined;
    if (!data) {
      continue;
    }
    const stats = extractLine(data.box, player.mlb_player_id);
    result[player.id] = { state: data.state, stats, points: livePoints(stats) };
  }
  return result;
}

/**
 * Live lines for every known player whose team has a game in progress, keyed by
 * player id. Bounded by the number of live games (one boxscore each), not the
 * player count, so it backs the free-agent browser cheaply.
 */
export async function getAllLiveLines(baseUrl = defaultBaseUrl, now = new Date()): Promise<Record<string, LiveLineupEntry>> {
  return tryDatabase(
    async () => {
      const players = await query<LivePlayerRef>(
        `select id, mlb_player_id, current_mlb_team_id
         from player
         where mlb_player_id is not null and current_mlb_team_id is not null`,
      );
      return getLiveLinesForPlayers(players.rows, baseUrl, now);
    },
    () => ({}),
  );
}

/**
 * Live status for a whole team's current lineup, keyed by player id. Only
 * players whose game is in progress appear in the map.
 */
export async function getLiveLineupStatus(teamId: string, baseUrl = defaultBaseUrl, now = new Date()): Promise<Record<string, LiveLineupEntry>> {
  return tryDatabase(
    async () => {
      const players = await query<LivePlayerRef>(
        `select p.id, p.mlb_player_id, p.current_mlb_team_id
         from lineup_entry le
         join player p on p.id = le.player_id
         where le.team_id = $1
           and le.lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)
           and p.mlb_player_id is not null
           and p.current_mlb_team_id is not null`,
        [teamId],
      );
      return getLiveLinesForPlayers(players.rows, baseUrl, now);
    },
    () => ({}),
  );
}
