import { getPool, query, withDemoFallback } from "@/lib/db/client";
import { defaultLeagueSettings } from "@/lib/fantasy/defaults";
import { leagueStandings, mockLeagueSettings } from "@/lib/fantasy/mock-data";
import { buildLeagueSettingsFromInput, type CreateLeagueInput } from "@/lib/fantasy/league-create";
import { formatRecord, rankStandings } from "@/lib/fantasy/season-schedule";
import type { LeagueOverview, LeagueSettings, LeagueStanding, LeagueTeamStats } from "@/lib/fantasy/types";
import { rotoStandingsForLeague } from "./roto";
import { ensureSeasonSchedule, teamRecordsForLeague } from "./season";

type LeagueSettingsRow = {
  id: string;
  name: string;
  scoring_type?: LeagueSettings["scoringType"];
  season_year?: number;
  status?: string;
  settings: LeagueSettings;
};

type LeagueTeamOverviewRow = {
  team_id: string;
  team_name: string;
  manager_name: string;
  waiver_priority: number | null;
  faab_remaining: string | number | null;
  rostered_players: string | number;
  matchup_score: string | number | null;
};

export async function getLeagueSettings(leagueId: string): Promise<LeagueSettings> {
  return withDemoFallback(
    async () => {
      const result = await query<LeagueSettingsRow>("select id, name, settings from league where id = $1", [leagueId]);
      return result.rows[0]?.settings ? { ...result.rows[0].settings, id: leagueId, name: result.rows[0].name } : defaultLeagueSettings;
    },
    () => defaultLeagueSettings,
  );
}

export async function getLeagueOverview(leagueId: string): Promise<LeagueOverview> {
  return withDemoFallback(
    async () => {
      const leagueResult = await query<LeagueSettingsRow>(
        `select id, name, scoring_type, season_year, status, settings
         from league
         where id = $1`,
        [leagueId],
      );
      const league = leagueResult.rows[0];

      if (!league) {
        return mockLeagueOverview(leagueId);
      }

      // Lazy season backfill: an active league always has a current schedule
      // (cheap no-op when periods already exist).
      await ensureSeasonSchedule(getPool(), leagueId);

      const teamsResult = await query<LeagueTeamOverviewRow>(
        `select
           ft.id as team_id,
           ft.name as team_name,
           u.display_name as manager_name,
           ft.waiver_priority,
           ft.faab_remaining,
           count(re.id) filter (where re.dropped_at is null) as rostered_players,
           active_matchup.score as matchup_score
         from fantasy_team ft
         join app_user u on u.id = ft.manager_user_id
         left join roster_entry re on re.team_id = ft.id and re.dropped_at is null
         left join lateral (
           select
             case when m.home_team_id = ft.id then m.home_score else m.away_score end as score
           from matchup m
           join scoring_period sp on sp.id = m.scoring_period_id
           where m.home_team_id = ft.id or m.away_team_id = ft.id
           order by
             case when m.status = 'active' then 0 else 1 end,
             sp.starts_at desc
           limit 1
         ) active_matchup on true
         where ft.league_id = $1
         group by ft.id, u.display_name, active_matchup.score
         order by coalesce(active_matchup.score, 0) desc, ft.waiver_priority nulls last, ft.name`,
        [leagueId],
      );

      const teamStats = teamsResult.rows.map(mapLeagueTeamStats);
      const scoringType = league.scoring_type ?? league.settings.scoringType;
      const managerByTeam = new Map(teamsResult.rows.map((row) => [row.team_id, row.manager_name]));

      let standings: LeagueStanding[];

      if (scoringType === "roto") {
        // Rotisserie: a season-long table of per-category ranks, no records.
        const roto = await rotoStandingsForLeague(leagueId);
        standings = roto.map(
          (row): LeagueStanding => ({
            teamId: row.teamId,
            teamName: row.teamName,
            managerName: managerByTeam.get(row.teamId) ?? "",
            rank: row.rank,
            record: `${row.points} pts`,
            points: row.points,
          }),
        );
      } else {
        // Head-to-head: W-L-T from finalized matchups, plus accumulated points
        // (finalized totals + the live score of the current matchup).
        const records = await teamRecordsForLeague(leagueId);
        const ranked = rankStandings(
          teamsResult.rows.map((row) => {
            const record = records.get(row.team_id);
            return {
              teamId: row.team_id,
              teamName: row.team_name,
              managerName: row.manager_name,
              wins: record?.wins ?? 0,
              losses: record?.losses ?? 0,
              ties: record?.ties ?? 0,
              points: (record?.points ?? 0) + toNumber(row.matchup_score),
            };
          }),
        );
        standings = ranked.map(
          (row, index): LeagueStanding => ({
            teamId: row.teamId,
            teamName: row.teamName,
            managerName: row.managerName,
            rank: index + 1,
            record: formatRecord(row),
            points: Math.round(row.points * 10) / 10,
          }),
        );
      }

      return {
        leagueId: league.id,
        name: league.name,
        scoringType: league.scoring_type ?? league.settings.scoringType,
        seasonYear: league.season_year ?? new Date().getFullYear(),
        status: league.status ?? "active",
        settings: { ...league.settings, id: league.id, name: league.name },
        standings,
        teamStats,
      };
    },
    () => mockLeagueOverview(leagueId),
  );
}

export type LeagueCommissioner = {
  email: string;
  displayName: string;
};

// Draft setup and other commissioner-only actions check league_member.role,
// so the creating session user must become the commissioner. The seed-user
// fallback only remains for callers with no session (e.g. scripts).
const fallbackCommissioner: LeagueCommissioner = { email: "alex@example.local", displayName: "Alex" };

export async function createLeague(input: CreateLeagueInput, commissioner: LeagueCommissioner = fallbackCommissioner) {
  return withDemoFallback(
    async () => {
      const settings = buildLeagueSettingsFromInput(input);
      // One transaction: a league without its commissioner membership, roster
      // slots, or stat categories permanently breaks draft setup and scoring.
      const client = await getPool().connect();

      try {
        await client.query("begin");

        const userResult = await client.query<{ id: string }>(
          `insert into app_user (email, display_name)
           values ($1, $2)
           on conflict (email) do update set display_name = excluded.display_name
           returning id`,
          [commissioner.email, commissioner.displayName],
        );
        const userId = userResult.rows[0].id;
        const leagueResult = await client.query<{ id: string }>(
          `insert into league (name, scoring_type, season_year, commissioner_user_id, status, settings)
           values ($1, $2, $3, $4, 'pre_draft', $5)
           returning id`,
          [input.name, input.scoringType, input.seasonYear, userId, JSON.stringify(settings)],
        );
        const leagueId = leagueResult.rows[0].id;

        await client.query(
          `insert into league_member (league_id, user_id, role)
           values ($1, $2, 'commissioner')
           on conflict (league_id, user_id) do update set role = excluded.role`,
          [leagueId, userId],
        );

        for (const [slot, count] of Object.entries(settings.rosterSlots)) {
          await client.query(
            `insert into league_roster_slot (league_id, slot, count)
             values ($1, $2, $3)
             on conflict (league_id, slot) do update set count = excluded.count`,
            [leagueId, slot, count],
          );
        }

        for (const [index, category] of settings.hitterCategories.entries()) {
          await client.query(
            `insert into league_stat_category (league_id, category, side, sort_order)
             values ($1, $2, 'hitting', $3)
             on conflict (league_id, category) do update set side = excluded.side, sort_order = excluded.sort_order`,
            [leagueId, category, index],
          );
        }

        for (const [index, category] of settings.pitcherCategories.entries()) {
          await client.query(
            `insert into league_stat_category (league_id, category, side, sort_order)
             values ($1, $2, 'pitching', $3)
             on conflict (league_id, category) do update set side = excluded.side, sort_order = excluded.sort_order`,
            [leagueId, category, index],
          );
        }

        await client.query("commit");

        return {
          id: leagueId,
          seasonYear: input.seasonYear,
          settings: { ...settings, id: leagueId },
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async () => ({
      id: "pending-persistence",
      seasonYear: input.seasonYear,
      settings: buildLeagueSettingsFromInput(input),
    }),
  );
}

function mapLeagueTeamStats(row: LeagueTeamOverviewRow): LeagueTeamStats {
  return {
    teamId: row.team_id,
    teamName: row.team_name,
    rosteredPlayers: toNumber(row.rostered_players),
    faabRemaining: toNumber(row.faab_remaining),
    waiverPriority: row.waiver_priority,
  };
}

function mockLeagueOverview(leagueId: string): LeagueOverview {
  return {
    leagueId,
    name: mockLeagueSettings.name,
    scoringType: mockLeagueSettings.scoringType,
    seasonYear: 2026,
    status: "active",
    settings: mockLeagueSettings,
    standings: leagueStandings.map((standing, index) => ({
      teamId: `mock-standing-${index + 1}`,
      teamName: standing.team,
      managerName: "Manager",
      rank: index + 1,
      record: standing.record,
      points: standing.points,
    })),
    teamStats: leagueStandings.map((standing, index) => ({
      teamId: `mock-standing-${index + 1}`,
      teamName: standing.team,
      rosteredPlayers: 23,
      faabRemaining: 100 - index * 7,
      waiverPriority: index + 1,
    })),
  };
}

function toNumber(value: string | number | null | undefined, fallback = 0) {
  if (value === null || value === undefined) {
    return fallback;
  }

  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isNaN(numeric) ? fallback : numeric;
}
