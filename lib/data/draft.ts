import type { PoolClient } from "pg";
import { computeExpiredTurns, deadlineForTurn } from "@/lib/draft/advancement";
import { computeRosterNeeds, filterCandidatesWithRoom, selectAutoPick, type DraftCandidate } from "@/lib/draft/auto-pick";
import { draftRounds, orderStrategyFor, roundForPick } from "@/lib/draft/engine";
import { planInitialLineup, rosterFits, type AssignablePlayer } from "@/lib/draft/lineup-assignment";
import { mockDraftPlayers, mockDraftState } from "@/lib/draft/mock-draft";
import {
  DraftError,
  type DraftPickRecord,
  type DraftPlayer,
  type DraftState,
  type DraftStatus,
  type DraftTeam,
  type QueuedPlayer,
} from "@/lib/draft/types";
import { defaultLeagueSettings } from "@/lib/fantasy/defaults";
import type { DraftType, LeagueSettings, PlayerPool, RosterSlot } from "@/lib/fantasy/types";
import { getPool, isDatabaseConfigured, tryDatabase, withDemoFallback } from "@/lib/db/client";
import { mapPlayer, type DbPlayerRow } from "./mappers";
import { sendPushToUser } from "./push-subscriptions";
import { ensureSeasonSchedule } from "./season";

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
  auto_pick: boolean;
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

// Division pools filter on league + division. The values are fixed constants
// (never user input), so interpolating them is injection-safe. Division names
// differ by source — mlb-sync stores the full "National League Central" while
// the seed stores the short "Central" — so match on the substring.
const divisionPoolFilters: Partial<Record<PlayerPool, { league: string; division: string }>> = {
  "al-east": { league: "American", division: "East" },
  "al-central": { league: "American", division: "Central" },
  "al-west": { league: "American", division: "West" },
  "nl-east": { league: "National", division: "East" },
  "nl-central": { league: "National", division: "Central" },
  "nl-west": { league: "National", division: "West" },
};

export function poolFilterSql(pool: PlayerPool, alias = "mt"): string {
  if (pool === "al") {
    return `and ${alias}.league ilike 'American%'`;
  }

  if (pool === "nl") {
    return `and ${alias}.league ilike 'National%'`;
  }

  const division = divisionPoolFilters[pool];

  if (division) {
    return `and ${alias}.league ilike '${division.league}%' and ${alias}.division ilike '%${division.division}%'`;
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
    `select o.team_id, o.position, o.auto_pick, t.name, t.is_bot, t.manager_user_id, u.display_name as manager_name, u.email as manager_email
     from draft_order o
     join fantasy_team t on t.id = o.team_id
     join app_user u on u.id = t.manager_user_id
     where o.draft_id = $1
     order by o.position`,
    [draftId],
  );

  return result.rows;
}

/** The non-bot team the viewer manages in this draft, if any. */
function viewerTeam(context: DraftContext, viewerUserId: string): OrderedTeamRow | null {
  return context.teams.find((team) => !team.is_bot && team.manager_user_id === viewerUserId) ?? null;
}

/**
 * The team's draft queue in priority order, excluding players already drafted
 * (a safety net; picks also delete queue rows). Used to render the viewer's
 * queue and drive auto-pick.
 */
async function getQueueForTeam(client: PoolClient, draftId: string, teamId: string): Promise<QueuedPlayer[]> {
  const result = await client.query<{ player_id: string; player_name: string; positions: RosterSlot[] | null }>(
    `select dq.player_id, p.full_name as player_name, dq.priority,
       coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
     from draft_queue dq
     join player p on p.id = dq.player_id
     left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
     where dq.draft_id = $1 and dq.team_id = $2
       and dq.player_id not in (select player_id from draft_pick where draft_id = $1)
     group by dq.player_id, p.full_name, dq.priority
     order by dq.priority`,
    [draftId, teamId],
  );

  return result.rows.map((row) => ({
    playerId: row.player_id,
    playerName: row.player_name,
    positions: row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[]),
  }));
}

/**
 * The first still-draftable player in a team's queue: undrafted, not in the
 * minors, and inside the league's player pool. Returns null when the queue has
 * no usable player, so auto-pick falls back to best-available.
 */
/**
 * The team's highest-priority queued player that is still available and that
 * the roster has room for; queued players who could only overfill the bench
 * are skipped (they stay queued for other teams' boards, but this team will
 * never draft them).
 */
async function firstAvailableQueuedPlayer(
  client: PoolClient,
  context: DraftContext,
  teamId: string,
  draftedPositions: RosterSlot[][],
): Promise<string | null> {
  const result = await client.query<{ player_id: string; positions: RosterSlot[] | null }>(
    `select dq.player_id,
       coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
     from draft_queue dq
     join player p on p.id = dq.player_id
     left join mlb_team mt on mt.id = p.current_mlb_team_id
     left join player_position_eligibility ppe on ppe.player_id = dq.player_id and ppe.valid_to is null
     where dq.draft_id = $1 and dq.team_id = $2
       and p.status <> 'minors'
       and dq.player_id not in (select player_id from draft_pick where draft_id = $1)
       ${poolFilterSql(context.league.settings.playerPool)}
     group by dq.player_id, dq.priority
     order by dq.priority`,
    [context.draft.id, teamId],
  );

  const slotCounts = context.league.settings.rosterSlots;
  const fitting = result.rows.find((row) =>
    rosterFits([...draftedPositions, row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[])], slotCounts),
  );

  return fitting?.player_id ?? null;
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
  // A drafted player is off the board, so drop them from every team's queue.
  await client.query(`delete from draft_queue where draft_id = $1 and player_id = $2`, [context.draft.id, playerId]);
}

/**
 * Auto/bot pick for one turn: the team's top still-available queued player if
 * it has one, otherwise best-available weighted by positional need.
 */
async function autoPickForTurn(client: PoolClient, context: DraftContext, overallPick: number): Promise<void> {
  const team = teamForPick(context, overallPick);
  const drafted = await draftedPositionsForTeam(client, context.draft.id, team.team_id);
  let playerId = await firstAvailableQueuedPlayer(client, context, team.team_id, drafted);

  if (!playerId) {
    const slotCounts = context.league.settings.rosterSlots;
    const candidates = await listAutoPickCandidates(client, context);
    const needs = computeRosterNeeds(slotCounts, drafted);
    const pick = selectAutoPick(filterCandidatesWithRoom(candidates, drafted, slotCounts), needs);

    if (!pick) {
      throw new DraftError("No draftable players remain in the pool.", 409);
    }

    playerId = pick.playerId;
  }

  await makePickInternal(client, context, overallPick, team.team_id, playerId, team.is_bot ? "bot" : "auto");
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

  const totalPicks = draft.rounds * teams.length;
  let picksMade = 0;

  // Phase 1: turns whose clock has expired (existing behavior).
  for (const overallPick of expiry.expiredPicks) {
    await autoPickForTurn(client, context, overallPick);
    picksMade += 1;
  }

  if (expiry.expiredPicks.length) {
    if (expiry.complete) {
      await completeDraft(client, context);
      draft.status = "complete";
      draft.current_pick_deadline = null;
      draft.current_overall_pick = expiry.expiredPicks[expiry.expiredPicks.length - 1];
    } else {
      draft.current_overall_pick = expiry.expiredPicks[expiry.expiredPicks.length - 1] + 1;
      draft.current_pick_deadline = expiry.nextDeadline;
    }
  }

  // Phase 2: teams that opted into auto-draft pick immediately, regardless of
  // their clock, so an absent/auto manager doesn't stall the room. Bounded by
  // the same per-call budget as phase 1.
  while (draft.status === "in_progress" && picksMade < MAX_ADVANCE_PER_CALL) {
    const cursor = draft.current_overall_pick;

    if (cursor > totalPicks || !teamForPick(context, cursor).auto_pick) {
      break;
    }

    await autoPickForTurn(client, context, cursor);
    picksMade += 1;

    if (cursor >= totalPicks) {
      await completeDraft(client, context);
      draft.status = "complete";
      draft.current_pick_deadline = null;
      draft.current_overall_pick = cursor;
      break;
    }

    const nextPick = cursor + 1;
    draft.current_overall_pick = nextPick;
    draft.current_pick_deadline = deadlineForTurn(now, teamForPick(context, nextPick).is_bot, draft.pick_seconds, draft.bot_pick_seconds);
  }

  if (picksMade === 0) {
    return;
  }

  if (draft.status === "complete") {
    // completeDraft already persisted the draft row.
    return;
  }

  await client.query(
    `update draft set current_overall_pick = $2, current_pick_deadline = $3, updated_at = now() where id = $1`,
    [draft.id, draft.current_overall_pick, draft.current_pick_deadline],
  );

  queueOnClockNotification(context, draft.current_overall_pick, notifications);
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

  // Initialize the waiver economy: reverse draft order sets waiver priority
  // (last pick claims first) and every team starts with the league's FAAB
  // budget. Without this, drafted leagues had null priorities and $0 budgets.
  for (const [index, team] of [...context.teams].reverse().entries()) {
    await client.query(
      `update fantasy_team set waiver_priority = $2, faab_remaining = coalesce(faab_remaining, $3) where id = $1`,
      [team.team_id, index + 1, context.league.settings.faabBudget ?? 0],
    );
  }

  // A completed draft starts the season: weekly scoring periods and
  // round-robin matchups through season end, with the current week active.
  await ensureSeasonSchedule(client, context.league.id);

  const period = await client.query<{ id: string }>(
    `select id from scoring_period where league_id = $1 and status = 'active' order by starts_at desc limit 1`,
    [context.league.id],
  );
  const scoringPeriodId = period.rows[0]?.id;

  if (!scoringPeriodId) {
    throw new DraftError("No scoring period could be activated for the league.", 500);
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
  viewerQueue: QueuedPlayer[] = [],
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
    myQueue: viewerQueue,
    myAutoPick: myTeam?.auto_pick ?? false,
    autoPickTeamIds: teams.filter((team) => team.auto_pick || team.is_bot).map((team) => team.team_id),
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
  return withDemoFallback(
    async () => {
      const client = await getPool().connect();
      const notifications: PendingNotification[] = [];

      try {
        await client.query("begin");
        const context = await lockDraftContext(client, leagueId);

        if (!context) {
          await client.query("rollback").catch(() => undefined);
          return null;
        }

        await advanceExpiredTurns(client, context, new Date(), notifications);
        const picks = await listPicks(client, context.draft.id);
        const commissioner = await isCommissioner(client, leagueId, viewerUserId);
        const myTeam = viewerTeam(context, viewerUserId);
        const viewerQueue = myTeam ? await getQueueForTeam(client, context.draft.id, myTeam.team_id) : [];
        await client.query("commit");
        flushNotifications(notifications);

        return buildDraftState(context, picks, { userId: viewerUserId, isCommissioner: commissioner }, new Date(), viewerQueue);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    () => mockDraftState(),
  );
}

// From here the fabricated-mock fallbacks use withDemoFallback: they stand in
// for the feature only in demo mode (no DATABASE_URL). With a database
// configured, a failure propagates so a signed-in user never sees a fake draft.

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
    const isMyTurn = onClock.manager_user_id === viewerUserId;

    // A pick may only be made for the team on the clock, and only by that
    // team's manager. The commissioner may act for a bot on the clock, but not
    // for another manager's live turn — a stalled human turn is resolved by
    // advanceExpiredTurns (auto-pick) above, not by a commissioner override.
    if (!isMyTurn && !(commissioner && onClock.is_bot)) {
      throw new DraftError(
        onClock.is_bot ? "A bot is on the clock." : "It is not your turn to pick.",
        403,
      );
    }

    const eligible = await client.query<{ positions: RosterSlot[] | null }>(
      `select coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
       from player p
       left join mlb_team mt on mt.id = p.current_mlb_team_id
       left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
       where p.id = $1 ${poolFilterSql(context.league.settings.playerPool)}
       group by p.id
       limit 1`,
      [playerId],
    );

    if (!eligible.rows.length) {
      throw new DraftError("That player is not in this league's player pool.", 422);
    }

    // Refuse picks the roster can never fit: once every slot (including the
    // bench) that this player could occupy is committed, drafting them would
    // overfill the bench at completion and block all lineup saves for the team.
    const pickPositions = eligible.rows[0].positions?.length ? eligible.rows[0].positions : (["UTIL"] as RosterSlot[]);
    const drafted = await draftedPositionsForTeam(client, context.draft.id, onClock.team_id);

    if (!rosterFits([...drafted, pickPositions], context.league.settings.rosterSlots)) {
      throw new DraftError("Your roster has no open slot for that player. Draft a position you still need.", 409);
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

    // If the manager(s) now on the clock are auto-drafting, take their picks
    // too so the room keeps moving.
    if (context.draft.status === "in_progress") {
      await advanceExpiredTurns(client, context, new Date(), notifications);
    }

    const picks = await listPicks(client, context.draft.id);
    const myTeam = viewerTeam(context, viewerUserId);
    const viewerQueue = myTeam ? await getQueueForTeam(client, context.draft.id, myTeam.team_id) : [];
    await client.query("commit");
    flushNotifications(notifications);

    return buildDraftState(context, picks, { userId: viewerUserId, isCommissioner: commissioner }, new Date(), viewerQueue);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Shared lock+transaction wrapper for draft mutations that return the viewer's
 * fresh DraftState (queue add/remove, auto-draft toggle). Mirrors makePick's
 * transaction handling.
 */
async function withDraftMutation(
  leagueId: string,
  viewerUserId: string,
  mutate: (
    client: PoolClient,
    context: DraftContext,
    team: OrderedTeamRow,
    notifications: PendingNotification[],
  ) => Promise<void>,
): Promise<DraftState> {
  requireDatabase();
  const client = await getPool().connect();
  const notifications: PendingNotification[] = [];

  try {
    await client.query("begin");
    const context = await lockDraftContext(client, leagueId);

    if (!context) {
      throw new DraftError("Draft has not been set up.", 404);
    }

    const team = viewerTeam(context, viewerUserId);

    if (!team) {
      throw new DraftError("You don't have a team in this draft.", 403);
    }

    await mutate(client, context, team, notifications);

    const picks = await listPicks(client, context.draft.id);
    const commissioner = await isCommissioner(client, leagueId, viewerUserId);
    const queue = await getQueueForTeam(client, context.draft.id, team.team_id);
    await client.query("commit");
    flushNotifications(notifications);

    return buildDraftState(context, picks, { userId: viewerUserId, isCommissioner: commissioner }, new Date(), queue);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Add a player to the viewer's team's draft queue (idempotent, appends last). */
export async function enqueueDraftPlayer(leagueId: string, playerId: string, viewerUserId: string): Promise<DraftState> {
  return withDraftMutation(leagueId, viewerUserId, async (client, context, team) => {
    if (context.draft.status === "complete") {
      throw new DraftError("The draft is over.", 409);
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

    const drafted = await client.query(`select 1 from draft_pick where draft_id = $1 and player_id = $2 limit 1`, [
      context.draft.id,
      playerId,
    ]);

    if (drafted.rows.length) {
      throw new DraftError("That player has already been drafted.", 409);
    }

    await client.query(
      `insert into draft_queue (draft_id, team_id, player_id, priority)
       values ($1, $2, $3, coalesce((select max(priority) from draft_queue where draft_id = $1 and team_id = $2), 0) + 1)
       on conflict (draft_id, team_id, player_id) do nothing`,
      [context.draft.id, team.team_id, playerId],
    );
  });
}

/** Remove a player from the viewer's team's draft queue. */
export async function dequeueDraftPlayer(leagueId: string, playerId: string, viewerUserId: string): Promise<DraftState> {
  return withDraftMutation(leagueId, viewerUserId, async (client, context, team) => {
    await client.query(`delete from draft_queue where draft_id = $1 and team_id = $2 and player_id = $3`, [
      context.draft.id,
      team.team_id,
      playerId,
    ]);
  });
}

/**
 * Turn auto-draft on or off for the viewer's team. Enabling it takes the pick
 * immediately if it's already the team's turn (and keeps taking auto teams'
 * turns), so an "exit draft" flip doesn't wait for the clock.
 */
export async function setAutoPick(leagueId: string, enabled: boolean, viewerUserId: string): Promise<DraftState> {
  return withDraftMutation(leagueId, viewerUserId, async (client, context, team, notifications) => {
    await client.query(`update draft_order set auto_pick = $3 where draft_id = $1 and team_id = $2`, [
      context.draft.id,
      team.team_id,
      enabled,
    ]);
    // Reflect the flag in the in-memory context so advanceExpiredTurns sees it.
    team.auto_pick = enabled;

    if (enabled && context.draft.status === "in_progress") {
      await advanceExpiredTurns(client, context, new Date(), notifications);
    }
  });
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
    await client.query("rollback").catch(() => undefined);
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
    await client.query("rollback").catch(() => undefined);
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
    await client.query("rollback").catch(() => undefined);
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
  return withDemoFallback(
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
  return withDemoFallback(
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
