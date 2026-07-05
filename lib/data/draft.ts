import type { PoolClient } from "pg";
import { computeExpiredTurns, deadlineForTurn } from "@/lib/draft/advancement";
import { computeRosterNeeds, selectAutoPick, type DraftCandidate } from "@/lib/draft/auto-pick";
import { draftRounds, orderStrategyFor, roundForPick } from "@/lib/draft/engine";
import { planInitialLineup, type AssignablePlayer } from "@/lib/draft/lineup-assignment";
import { mockDraftPlayers, mockDraftState } from "@/lib/draft/mock-draft";
import {
  DraftError,
  type DraftPickRecord,
  type DraftPlayer,
  type DraftState,
  type DraftStatus,
  type DraftTeam,
} from "@/lib/draft/types";
import { defaultLeagueSettings } from "@/lib/fantasy/defaults";
import type { DraftType, LeagueSettings, PlayerPool, RosterSlot } from "@/lib/fantasy/types";
import { getPool, isDatabaseConfigured, tryDatabase } from "@/lib/db/client";
import { mapPlayer, type DbPlayerRow } from "./mappers";
import { sendPushToUser } from "./push-subscriptions";

export { DraftError };

const BOT_SENTINEL_EMAIL = "bots@ofb.internal";
const MAX_ADVANCE_PER_CALL = 20;
const AUTO_PICK_CANDIDATE_LIMIT = 120;

const botTeamNames = [
  "Bot: Bleacher Creatures",
  "Bot: Rally Caps",
  "Bot: Dinger City",
  "Bot: The Shift",
  "Bot: Mendoza Liners",
  "Bot: Cannon Arms",
  "Bot: Rosin Baggers",
  "Bot: Warning Track",
  "Bot: Eephus Kings",
  "Bot: Squeeze Play",
  "Bot: Hot Corner",
  "Bot: Uncle Charlie",
  "Bot: Moon Shots",
  "Bot: Golden Sombrero",
  "Bot: Twin Killings",
  "Bot: Pine Tar",
] as const;

type DraftRow = {
  id: string;
  league_id: string;
  draft_type: DraftType;
  status: DraftStatus;
  pick_seconds: number;
  bot_pick_seconds: number;
  rounds: number;
  current_overall_pick: number;
  current_pick_deadline: Date | null;
  paused_remaining_seconds: string | number | null;
};

type LeagueRow = {
  id: string;
  name: string;
  status: string;
  settings: LeagueSettings;
  commissioner_user_id: string;
};

type OrderedTeamRow = {
  team_id: string;
  position: number;
  name: string;
  is_bot: boolean;
  manager_user_id: string;
  manager_name: string;
  manager_email: string;
};

type DraftContext = {
  draft: DraftRow;
  league: LeagueRow;
  teams: OrderedTeamRow[];
};

type PendingNotification = {
  email: string;
  title: string;
  body: string;
  url: string;
};

function settingsWithDefaults(settings: LeagueSettings): LeagueSettings {
  return {
    ...defaultLeagueSettings,
    ...settings,
    playerPool: settings.playerPool ?? defaultLeagueSettings.playerPool,
    draftPickSeconds: settings.draftPickSeconds ?? defaultLeagueSettings.draftPickSeconds,
  };
}

function poolFilterSql(pool: PlayerPool, alias = "mt"): string {
  if (pool === "al") {
    return `and ${alias}.league ilike 'American%'`;
  }

  if (pool === "nl") {
    return `and ${alias}.league ilike 'National%'`;
  }

  return "";
}

async function getLeague(client: PoolClient, leagueId: string): Promise<LeagueRow> {
  const result = await client.query<LeagueRow>(
    `select id, name, status, settings, commissioner_user_id from league where id = $1`,
    [leagueId],
  );
  const league = result.rows[0];

  if (!league) {
    throw new DraftError("League not found.", 404);
  }

  return { ...league, settings: settingsWithDefaults(league.settings) };
}

async function getOrderedTeams(client: PoolClient, draftId: string): Promise<OrderedTeamRow[]> {
  const result = await client.query<OrderedTeamRow>(
    `select o.team_id, o.position, t.name, t.is_bot, t.manager_user_id, u.display_name as manager_name, u.email as manager_email
     from draft_order o
     join fantasy_team t on t.id = o.team_id
     join app_user u on u.id = t.manager_user_id
     where o.draft_id = $1
     order by o.position`,
    [draftId],
  );

  return result.rows;
}

/**
 * Locks the draft row and loads the full context. All mutating paths and the
 * lazy clock advancement go through this lock, so concurrent pollers/pickers
 * serialize here and re-read consistent state.
 */
async function lockDraftContext(client: PoolClient, leagueId: string): Promise<DraftContext | null> {
  const result = await client.query<DraftRow>(`select * from draft where league_id = $1 for update`, [leagueId]);
  const draft = result.rows[0];

  if (!draft) {
    return null;
  }

  const league = await getLeague(client, leagueId);
  const teams = await getOrderedTeams(client, draft.id);
  return { draft, league, teams };
}

function teamForPick(context: DraftContext, overallPick: number): OrderedTeamRow {
  const strategy = orderStrategyFor(context.draft.draft_type);
  const index = strategy.teamIndexForPick(overallPick, context.teams.length);
  return context.teams[index];
}

/** Whether the user manages a league (commissioner or co-commissioner member). */
async function isCommissioner(client: PoolClient, leagueId: string, userId: string): Promise<boolean> {
  const result = await client.query(
    `select 1 from league_member
     where league_id = $1 and user_id = $2 and role in ('commissioner', 'co_commissioner')
     limit 1`,
    [leagueId, userId],
  );

  return result.rows.length > 0;
}

/**
 * Undrafted, pool-filtered candidates ordered best-first: external ADP rank
 * when synced, season fan points otherwise. row_number() re-ranks after the
 * fallback merge so auto-pick always sees a dense 1..N ranking.
 */
async function listAutoPickCandidates(client: PoolClient, context: DraftContext): Promise<DraftCandidate[]> {
  const result = await client.query<{ id: string; adp_rank: number; positions: RosterSlot[] | null }>(
    `select
       p.id,
       (row_number() over (order by adp.adp_rank asc nulls last, p.season_fan_points desc nulls last, p.full_name))::int as adp_rank,
       coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
     from player p
     left join mlb_team mt on mt.id = p.current_mlb_team_id
     left join player_adp adp on adp.player_id = p.id
     left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
     where p.id not in (select player_id from draft_pick where draft_id = $1)
       and p.status <> 'minors'
       ${poolFilterSql(context.league.settings.playerPool)}
     group by p.id, adp.adp_rank
     order by adp.adp_rank asc nulls last, p.season_fan_points desc nulls last, p.full_name
     limit ${AUTO_PICK_CANDIDATE_LIMIT}`,
    [context.draft.id],
  );

  return result.rows.map((row) => ({
    playerId: row.id,
    adpRank: row.adp_rank,
    positions: row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[]),
  }));
}

async function draftedPositionsForTeam(client: PoolClient, draftId: string, teamId: string): Promise<RosterSlot[][]> {
  const result = await client.query<{ positions: RosterSlot[] | null }>(
    `select coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
     from draft_pick dp
     left join player_position_eligibility ppe on ppe.player_id = dp.player_id and ppe.valid_to is null
     where dp.draft_id = $1 and dp.team_id = $2
     group by dp.id`,
    [draftId, teamId],
  );

  return result.rows.map((row) => (row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[])));
}

/** Insert one pick and its roster/audit rows; the caller owns the transaction. */
async function makePickInternal(
  client: PoolClient,
  context: DraftContext,
  overallPick: number,
  teamId: string,
  playerId: string,
  madeBy: "human" | "auto" | "bot",
): Promise<void> {
  const { round, pickInRound } = roundForPick(overallPick, context.teams.length);

  try {
    await client.query(
      `insert into draft_pick (draft_id, overall_pick, round, pick_in_round, team_id, player_id, made_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [context.draft.id, overallPick, round, pickInRound, teamId, playerId, madeBy],
    );
  } catch (error) {
    // unique(draft_id, player_id) or unique(draft_id, overall_pick): another
    // transaction beat us to this player or pick slot.
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
      throw new DraftError("That player has already been drafted.", 409);
    }

    throw error;
  }

  await client.query(
    `insert into roster_entry (team_id, player_id, acquisition_type)
     values ($1, $2, 'draft')`,
    [teamId, playerId],
  );
  await client.query(
    `insert into fantasy_transaction (league_id, team_id, type, status, payload)
     values ($1, $2, 'add', 'processed', $3)`,
    [context.league.id, teamId, JSON.stringify({ playerId, draftPick: overallPick, madeBy })],
  );
}

/** Auto/bot pick for one expired turn: best available with positional need. */
async function autoPickForTurn(client: PoolClient, context: DraftContext, overallPick: number): Promise<void> {
  const team = teamForPick(context, overallPick);
  const candidates = await listAutoPickCandidates(client, context);
  const drafted = await draftedPositionsForTeam(client, context.draft.id, team.team_id);
  const needs = computeRosterNeeds(context.league.settings.rosterSlots, drafted);
  const pick = selectAutoPick(candidates, needs);

  if (!pick) {
    throw new DraftError("No draftable players remain in the pool.", 409);
  }

  await makePickInternal(client, context, overallPick, team.team_id, pick.playerId, team.is_bot ? "bot" : "auto");
}

/**
 * Lazy clock advancement: resolve every expired turn as of `now`, update the
 * draft cursor/deadline, and complete the draft when the last pick lands.
 * Runs inside the caller's transaction, after lockDraftContext.
 */
async function advanceExpiredTurns(
  client: PoolClient,
  context: DraftContext,
  now: Date,
  notifications: PendingNotification[],
): Promise<void> {
  const { draft, teams } = context;

  if (draft.status !== "in_progress") {
    return;
  }

  const expiry = computeExpiredTurns(
    {
      status: draft.status,
      currentOverallPick: draft.current_overall_pick,
      currentPickDeadline: draft.current_pick_deadline,
      pickSeconds: draft.pick_seconds,
      botPickSeconds: draft.bot_pick_seconds,
      teamCount: teams.length,
      rounds: draft.rounds,
      onClockIsBot: (pick) => teamForPick(context, pick).is_bot,
    },
    now,
    MAX_ADVANCE_PER_CALL,
  );

  if (!expiry.expiredPicks.length) {
    return;
  }

  for (const overallPick of expiry.expiredPicks) {
    await autoPickForTurn(client, context, overallPick);
  }

  const nextPick = expiry.expiredPicks[expiry.expiredPicks.length - 1] + 1;

  if (expiry.complete) {
    await completeDraft(client, context);
    draft.status = "complete";
    draft.current_pick_deadline = null;
    draft.current_overall_pick = nextPick - 1;
    return;
  }

  await client.query(
    `update draft set current_overall_pick = $2, current_pick_deadline = $3, updated_at = now() where id = $1`,
    [draft.id, nextPick, expiry.nextDeadline],
  );
  draft.current_overall_pick = nextPick;
  draft.current_pick_deadline = expiry.nextDeadline;

  queueOnClockNotification(context, nextPick, notifications);
}

function queueOnClockNotification(context: DraftContext, overallPick: number, notifications: PendingNotification[]) {
  const team = teamForPick(context, overallPick);

  if (team.is_bot || team.manager_email === BOT_SENTINEL_EMAIL) {
    return;
  }

  const { round, pickInRound } = roundForPick(overallPick, context.teams.length);
  notifications.push({
    email: team.manager_email,
    title: "You're on the clock",
    body: `${context.league.name}: pick ${round}.${String(pickInRound).padStart(2, "0")} is yours.`,
    url: `/draft/${context.league.id}`,
  });
}

/** Fire-and-forget after commit so push latency never holds the row lock. */
function flushNotifications(notifications: PendingNotification[]) {
  for (const notification of notifications) {
    void sendPushToUser(notification.email, {
      title: notification.title,
      body: notification.body,
      url: notification.url,
      tag: "draft-on-clock",
    }).catch(() => undefined);
  }
}

/**
 * Marks the draft/league complete and assigns every team's initial lineup.
 * Ensures an active scoring_period exists first: lineup_entry requires one,
 * and a pre-season league typically has none yet.
 */
async function completeDraft(client: PoolClient, context: DraftContext): Promise<void> {
  await client.query(`update draft set status = 'complete', current_pick_deadline = null, completed_at = now(), updated_at = now() where id = $1`, [
    context.draft.id,
  ]);
  await client.query(`update league set status = 'active', updated_at = now() where id = $1`, [context.league.id]);

  const period = await client.query<{ id: string }>(
    `select id from scoring_period where league_id = $1 and status = 'active' order by starts_at desc limit 1`,
    [context.league.id],
  );
  let scoringPeriodId = period.rows[0]?.id;

  if (!scoringPeriodId) {
    const created = await client.query<{ id: string }>(
      `insert into scoring_period (league_id, label, starts_at, ends_at, status)
       values ($1, 'Draft Week', now(), now() + interval '7 days', 'active')
       on conflict (league_id, label) do update set status = 'active'
       returning id`,
      [context.league.id],
    );
    scoringPeriodId = created.rows[0].id;
  }

  for (const team of context.teams) {
    const rosterResult = await client.query<{ id: string; status: AssignablePlayer["status"]; positions: RosterSlot[] | null }>(
      `select p.id, p.status,
         coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
       from draft_pick dp
       join player p on p.id = dp.player_id
       left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
       where dp.draft_id = $1 and dp.team_id = $2
       group by p.id`,
      [context.draft.id, team.team_id],
    );

    const assignments = planInitialLineup(
      rosterResult.rows.map((row) => ({
        playerId: row.id,
        status: row.status,
        positions: row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[]),
      })),
      context.league.settings.rosterSlots,
    );

    for (const assignment of assignments) {
      await client.query(
        `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot)
         values ($1, $2, $3, current_date, $4)
         on conflict (team_id, player_id, lineup_date) do update set slot = excluded.slot`,
        [team.team_id, assignment.playerId, scoringPeriodId, assignment.slot],
      );
    }
  }
}

function buildDraftState(
  context: DraftContext,
  picks: DraftPickRecord[],
  viewer: { userId: string; isCommissioner: boolean },
  now: Date,
): DraftState {
  const { draft, league, teams } = context;
  const totalPickCount = draft.rounds * teams.length;
  const onClockPick = draft.status === "in_progress" || draft.status === "paused" ? draft.current_overall_pick : null;
  const onClockTeam = onClockPick && onClockPick <= totalPickCount ? teamForPick(context, onClockPick) : null;
  const myTeam = teams.find((team) => !team.is_bot && team.manager_user_id === viewer.userId) ?? null;

  return {
    draftId: draft.id,
    leagueId: league.id,
    leagueName: league.name,
    status: draft.status,
    pickSeconds: draft.pick_seconds,
    rounds: draft.rounds,
    teamCount: teams.length,
    teams: teams.map(
      (team): DraftTeam => ({
        teamId: team.team_id,
        name: team.name,
        managerName: team.is_bot ? "Bot" : team.manager_name,
        isBot: team.is_bot,
        position: team.position,
      }),
    ),
    picks,
    onClock:
      onClockPick && onClockTeam
        ? { teamId: onClockTeam.team_id, overallPick: onClockPick, ...roundForPick(onClockPick, teams.length) }
        : null,
    deadline: draft.current_pick_deadline ? draft.current_pick_deadline.toISOString() : null,
    serverNow: now.toISOString(),
    myTeamId: myTeam?.team_id ?? null,
    viewerIsCommissioner: viewer.isCommissioner,
  };
}

async function listPicks(client: PoolClient, draftId: string): Promise<DraftPickRecord[]> {
  const result = await client.query<{
    overall_pick: number;
    round: number;
    pick_in_round: number;
    team_id: string;
    player_id: string;
    player_name: string;
    positions: RosterSlot[] | null;
    made_by: "human" | "auto" | "bot";
  }>(
    `select dp.overall_pick, dp.round, dp.pick_in_round, dp.team_id, dp.player_id, p.full_name as player_name,
       coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions,
       dp.made_by
     from draft_pick dp
     join player p on p.id = dp.player_id
     left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
     where dp.draft_id = $1
     group by dp.id, p.full_name
     order by dp.overall_pick`,
    [draftId],
  );

  return result.rows.map((row) => ({
    overallPick: row.overall_pick,
    round: row.round,
    pickInRound: row.pick_in_round,
    teamId: row.team_id,
    playerId: row.player_id,
    playerName: row.player_name,
    positions: row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[]),
    madeBy: row.made_by,
  }));
}

/**
 * The draft-room poll read: advance any expired turns, then return the state.
 * Returns null when the league has no draft yet (setup not run).
 */
export async function getDraftState(leagueId: string, viewerUserId: string): Promise<DraftState | null> {
  return tryDatabase(
    async () => {
      const client = await getPool().connect();
      const notifications: PendingNotification[] = [];

      try {
        await client.query("begin");
        const context = await lockDraftContext(client, leagueId);

        if (!context) {
          await client.query("rollback");
          return null;
        }

        await advanceExpiredTurns(client, context, new Date(), notifications);
        const picks = await listPicks(client, context.draft.id);
        const commissioner = await isCommissioner(client, leagueId, viewerUserId);
        await client.query("commit");
        flushNotifications(notifications);

        return buildDraftState(context, picks, { userId: viewerUserId, isCommissioner: commissioner }, new Date());
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    () => mockDraftState(),
  );
}

/** A human (or the commissioner acting for a team) makes the on-clock pick. */
export async function makePick(leagueId: string, playerId: string, viewerUserId: string): Promise<DraftState> {
  requireDatabase();
  const client = await getPool().connect();
  const notifications: PendingNotification[] = [];

  try {
    await client.query("begin");
    const context = await lockDraftContext(client, leagueId);

    if (!context) {
      throw new DraftError("Draft has not been set up.", 404);
    }

    // Resolve any backlog first so a stale client gets a clean answer.
    await advanceExpiredTurns(client, context, new Date(), notifications);

    if (context.draft.status !== "in_progress") {
      throw new DraftError(`Draft is ${context.draft.status.replace("_", " ")}.`, 409);
    }

    const onClock = teamForPick(context, context.draft.current_overall_pick);
    const commissioner = await isCommissioner(client, leagueId, viewerUserId);

    if (!commissioner && onClock.manager_user_id !== viewerUserId) {
      throw new DraftError("It is not your turn to pick.", 403);
    }

    if (onClock.is_bot && !commissioner) {
      throw new DraftError("A bot is on the clock.", 403);
    }

    const eligible = await client.query(
      `select 1
       from player p
       left join mlb_team mt on mt.id = p.current_mlb_team_id
       where p.id = $1 ${poolFilterSql(context.league.settings.playerPool)}
       limit 1`,
      [playerId],
    );

    if (!eligible.rows.length) {
      throw new DraftError("That player is not in this league's player pool.", 422);
    }

    const overallPick = context.draft.current_overall_pick;
    await makePickInternal(client, context, overallPick, onClock.team_id, playerId, "human");

    const lastPick = context.draft.rounds * context.teams.length;

    if (overallPick >= lastPick) {
      await completeDraft(client, context);
      context.draft.status = "complete";
      context.draft.current_pick_deadline = null;
    } else {
      const nextPick = overallPick + 1;
      const nextIsBot = teamForPick(context, nextPick).is_bot;
      const deadline = deadlineForTurn(new Date(), nextIsBot, context.draft.pick_seconds, context.draft.bot_pick_seconds);
      await client.query(
        `update draft set current_overall_pick = $2, current_pick_deadline = $3, updated_at = now() where id = $1`,
        [context.draft.id, nextPick, deadline],
      );
      context.draft.current_overall_pick = nextPick;
      context.draft.current_pick_deadline = deadline;
      queueOnClockNotification(context, nextPick, notifications);
    }

    const picks = await listPicks(client, context.draft.id);
    await client.query("commit");
    flushNotifications(notifications);

    return buildDraftState(context, picks, { userId: viewerUserId, isCommissioner: commissioner }, new Date());
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export type SetupDraftInput = {
  pickSeconds: number;
  randomizeOrder: boolean;
  order?: string[];
  fillWithBots: boolean;
  myTeamName: string;
};

/**
 * Commissioner draft setup: creates the commissioner's team if missing, fills
 * the remaining seats with bot teams, and (re)writes the draft order. Can be
 * re-run while the draft is still in setup.
 */
export async function setupDraft(leagueId: string, viewerUserId: string, input: SetupDraftInput): Promise<DraftState> {
  requireDatabase();
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const league = await getLeague(client, leagueId);

    if (!(await isCommissioner(client, leagueId, viewerUserId))) {
      throw new DraftError("Only the commissioner can set up the draft.", 403);
    }

    if (league.status !== "pre_draft") {
      throw new DraftError("The draft can only be set up before it starts.", 409);
    }

    // The commissioner's own team.
    const myTeamName = input.myTeamName.trim();

    if (myTeamName.length < 3) {
      throw new DraftError("Team name must be at least 3 characters.", 400);
    }

    const existingMine = await client.query<{ id: string }>(
      `select id from fantasy_team where league_id = $1 and manager_user_id = $2 and is_bot = false limit 1`,
      [leagueId, viewerUserId],
    );

    if (existingMine.rows.length) {
      await client.query(`update fantasy_team set name = $2, updated_at = now() where id = $1`, [
        existingMine.rows[0].id,
        myTeamName,
      ]);
    } else {
      await client.query(
        `insert into fantasy_team (league_id, manager_user_id, name)
         values ($1, $2, $3)`,
        [leagueId, viewerUserId, myTeamName],
      );
    }

    if (input.fillWithBots) {
      const seatCount = await client.query<{ count: string }>(
        `select count(*)::text as count from fantasy_team where league_id = $1`,
        [leagueId],
      );
      const missing = league.settings.teamCount - Number(seatCount.rows[0].count);

      if (missing > 0) {
        const sentinel = await client.query<{ id: string }>(
          `insert into app_user (email, display_name) values ($1, 'OFB Bot')
           on conflict (email) do update set display_name = excluded.display_name
           returning id`,
          [BOT_SENTINEL_EMAIL],
        );
        const botUserId = sentinel.rows[0].id;
        const takenNames = await client.query<{ name: string }>(`select name from fantasy_team where league_id = $1`, [
          leagueId,
        ]);
        const taken = new Set(takenNames.rows.map((row) => row.name));
        const available = botTeamNames.filter((name) => !taken.has(name));

        for (let index = 0; index < missing; index++) {
          const name = available[index] ?? `Bot Team ${index + 1}`;
          await client.query(
            `insert into fantasy_team (league_id, manager_user_id, name, is_bot)
             values ($1, $2, $3, true)`,
            [leagueId, botUserId, name],
          );
        }
      }
    }

    const teams = await client.query<{ id: string }>(
      `select id from fantasy_team where league_id = $1 order by created_at, id`,
      [leagueId],
    );
    let orderedTeamIds = teams.rows.map((row) => row.id);

    if (input.order?.length) {
      const known = new Set(orderedTeamIds);

      if (input.order.length !== orderedTeamIds.length || input.order.some((teamId) => !known.has(teamId))) {
        throw new DraftError("Draft order must include every team exactly once.", 422);
      }

      orderedTeamIds = input.order;
    } else if (input.randomizeOrder) {
      orderedTeamIds = shuffle(orderedTeamIds);
    }

    const rounds = draftRounds(league.settings.rosterSlots);
    const draftResult = await client.query<{ id: string }>(
      `insert into draft (league_id, draft_type, status, pick_seconds, rounds)
       values ($1, $2, 'setup', $3, $4)
       on conflict (league_id) do update set
         pick_seconds = excluded.pick_seconds,
         rounds = excluded.rounds,
         updated_at = now()
       returning id`,
      [leagueId, league.settings.draftType, input.pickSeconds, rounds],
    );
    const draftId = draftResult.rows[0].id;

    await client.query(`delete from draft_order where draft_id = $1`, [draftId]);

    for (const [index, teamId] of orderedTeamIds.entries()) {
      await client.query(`insert into draft_order (draft_id, position, team_id) values ($1, $2, $3)`, [
        draftId,
        index + 1,
        teamId,
      ]);
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const state = await getDraftState(leagueId, viewerUserId);

  if (!state) {
    throw new DraftError("Draft setup did not persist.", 500);
  }

  return state;
}

export async function startDraft(leagueId: string, viewerUserId: string): Promise<DraftState> {
  requireDatabase();
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const context = await lockDraftContext(client, leagueId);

    if (!context) {
      throw new DraftError("Set up the draft before starting it.", 409);
    }

    if (!(await isCommissioner(client, leagueId, viewerUserId))) {
      throw new DraftError("Only the commissioner can start the draft.", 403);
    }

    if (context.draft.status !== "setup") {
      throw new DraftError("The draft has already started.", 409);
    }

    if (context.teams.length !== context.league.settings.teamCount) {
      throw new DraftError(
        `The league needs ${context.league.settings.teamCount} teams before drafting (currently ${context.teams.length}). Fill open seats with bots in draft setup.`,
        409,
      );
    }

    const firstTeam = teamForPick(context, 1);
    const deadline = deadlineForTurn(new Date(), firstTeam.is_bot, context.draft.pick_seconds, context.draft.bot_pick_seconds);

    await client.query(
      `update draft set status = 'in_progress', started_at = now(), current_overall_pick = 1, current_pick_deadline = $2, updated_at = now()
       where id = $1`,
      [context.draft.id, deadline],
    );
    await client.query(`update league set status = 'drafting', updated_at = now() where id = $1`, [leagueId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const state = await getDraftState(leagueId, viewerUserId);

  if (!state) {
    throw new DraftError("Draft state unavailable after start.", 500);
  }

  return state;
}

export async function pauseDraft(leagueId: string, viewerUserId: string, action: "pause" | "resume"): Promise<DraftState> {
  requireDatabase();
  const client = await getPool().connect();

  try {
    await client.query("begin");
    const context = await lockDraftContext(client, leagueId);

    if (!context) {
      throw new DraftError("Draft has not been set up.", 404);
    }

    if (!(await isCommissioner(client, leagueId, viewerUserId))) {
      throw new DraftError("Only the commissioner can pause or resume the draft.", 403);
    }

    if (action === "pause") {
      if (context.draft.status !== "in_progress") {
        throw new DraftError("Only an in-progress draft can be paused.", 409);
      }

      await client.query(
        `update draft set status = 'paused',
           paused_remaining_seconds = greatest(extract(epoch from (current_pick_deadline - now())), 0),
           current_pick_deadline = null,
           updated_at = now()
         where id = $1`,
        [context.draft.id],
      );
    } else {
      if (context.draft.status !== "paused") {
        throw new DraftError("Only a paused draft can be resumed.", 409);
      }

      await client.query(
        `update draft set status = 'in_progress',
           current_pick_deadline = now() + make_interval(secs => coalesce(paused_remaining_seconds, pick_seconds)),
           paused_remaining_seconds = null,
           updated_at = now()
         where id = $1`,
        [context.draft.id],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const state = await getDraftState(leagueId, viewerUserId);

  if (!state) {
    throw new DraftError("Draft state unavailable.", 500);
  }

  return state;
}

/**
 * Available players for the draft board: undrafted, pool-filtered, best ADP
 * first with derived-ranking fallback. Returns the top slice plus search.
 */
export async function listDraftPlayers(
  leagueId: string,
  options: { query?: string; position?: RosterSlot; limit?: number } = {},
): Promise<DraftPlayer[]> {
  return tryDatabase(
    async () => {
      const client = await getPool().connect();

      try {
        const league = await getLeague(client, leagueId);
        const draftResult = await client.query<{ id: string }>(`select id from draft where league_id = $1`, [leagueId]);
        const draftId = draftResult.rows[0]?.id ?? null;
        const values: unknown[] = [draftId];
        let filterSql = "";

        if (options.query) {
          values.push(`%${options.query}%`);
          filterSql += ` and p.full_name ilike $${values.length}`;
        }

        const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
        const result = await client.query<DbPlayerRow & { adp: string | number | null; adp_rank: number | null }>(
          `select
             p.id,
             p.mlb_player_id,
             p.full_name,
             mt.abbreviation as mlb_team,
             p.status,
             coalesce(array_agg(distinct ppe.position order by ppe.position) filter (where ppe.position is not null), '{}') as positions,
             'free-agent' as availability,
             coalesce(season_stats.stats, '{}'::jsonb) as season_stats,
             coalesce(projection_stats.stats, '{}'::jsonb) as projected_stats,
             p.season_fan_points,
             adp.adp,
             (row_number() over (order by adp.adp_rank asc nulls last, p.season_fan_points desc nulls last, p.full_name))::int as adp_rank
           from player p
           left join mlb_team mt on mt.id = p.current_mlb_team_id
           left join player_adp adp on adp.player_id = p.id
           left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
           left join lateral (
             select stats from player_stat_line psl where psl.player_id = p.id and split = 'season' order by stat_date desc limit 1
           ) season_stats on true
           left join lateral (
             select stats from player_stat_line psl where psl.player_id = p.id and split = 'projection_ros' order by stat_date desc limit 1
           ) projection_stats on true
           where ($1::uuid is null or p.id not in (select player_id from draft_pick where draft_id = $1))
             ${poolFilterSql(league.settings.playerPool)}
             ${filterSql}
           group by p.id, mt.abbreviation, season_stats.stats, projection_stats.stats, adp.adp, adp.adp_rank
           order by adp.adp_rank asc nulls last, p.season_fan_points desc nulls last, p.full_name
           limit ${limit}`,
          values,
        );

        const mapped = result.rows.map((row) => ({
          ...mapPlayer(row),
          adp: row.adp !== null && row.adp !== undefined ? Number(row.adp) : null,
          adpRank: row.adp_rank,
        }));

        return options.position
          ? mapped.filter((player) => player.positions.includes(options.position!))
          : mapped;
      } finally {
        client.release();
      }
    },
    () => {
      const players = mockDraftPlayers();
      return players.filter((player) => {
        const matchesQuery = options.query ? player.name.toLowerCase().includes(options.query.toLowerCase()) : true;
        const matchesPosition = options.position ? player.positions.includes(options.position) : true;
        return matchesQuery && matchesPosition;
      });
    },
  );
}

export type DraftLobby = {
  leagueId: string;
  leagueName: string;
  leagueStatus: string;
  teamCount: number;
  seatCount: number;
  defaultPickSeconds: number;
  viewerIsCommissioner: boolean;
  myTeamName: string | null;
};

/**
 * Pre-draft lobby info for the draft page: league identity, seat counts, and
 * whether the viewer can run setup. Works before any draft row exists.
 */
export async function getDraftLobby(leagueId: string, viewerUserId: string): Promise<DraftLobby | null> {
  return tryDatabase(
    async () => {
      const client = await getPool().connect();

      try {
        const league = await getLeague(client, leagueId);
        const seats = await client.query<{ count: string }>(
          `select count(*)::text as count from fantasy_team where league_id = $1`,
          [leagueId],
        );
        const mine = await client.query<{ name: string }>(
          `select name from fantasy_team where league_id = $1 and manager_user_id = $2 and is_bot = false limit 1`,
          [leagueId, viewerUserId],
        );

        return {
          leagueId: league.id,
          leagueName: league.name,
          leagueStatus: league.status,
          teamCount: league.settings.teamCount,
          seatCount: Number(seats.rows[0].count),
          defaultPickSeconds: league.settings.draftPickSeconds,
          viewerIsCommissioner: await isCommissioner(client, leagueId, viewerUserId),
          myTeamName: mine.rows[0]?.name ?? null,
        };
      } finally {
        client.release();
      }
    },
    () => {
      const mock = mockDraftState();
      return {
        leagueId: mock.leagueId,
        leagueName: mock.leagueName,
        leagueStatus: "drafting",
        teamCount: mock.teamCount,
        seatCount: mock.teamCount,
        defaultPickSeconds: mock.pickSeconds,
        viewerIsCommissioner: true,
        myTeamName: mock.teams[0].name,
      };
    },
  );
}

export type DraftableLeague = {
  leagueId: string;
  leagueName: string;
  status: "pre_draft" | "drafting";
};

/** Leagues the user belongs to that are waiting on (or running) a draft. */
export async function listDraftableLeagues(viewerUserId: string): Promise<DraftableLeague[]> {
  return tryDatabase(
    async () => {
      const result = await getPool().query<{ id: string; name: string; status: "pre_draft" | "drafting" }>(
        `select distinct l.id, l.name, l.status
         from league l
         left join league_member lm on lm.league_id = l.id
         left join fantasy_team ft on ft.league_id = l.id and ft.is_bot = false
         where l.status in ('pre_draft', 'drafting')
           and (lm.user_id = $1 or ft.manager_user_id = $1)
         order by l.status desc, l.name`,
        [viewerUserId],
      );

      return result.rows.map((row) => ({ leagueId: row.id, leagueName: row.name, status: row.status }));
    },
    () => [],
  );
}

function requireDatabase() {
  if (!isDatabaseConfigured()) {
    throw new DraftError("Drafting requires a configured database.", 503);
  }
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}
