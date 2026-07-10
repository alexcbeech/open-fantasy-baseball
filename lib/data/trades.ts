import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/client";
import type { ApiIdentity } from "@/lib/auth/api-identity";
import { enqueueNotificationForTeam } from "@/lib/data/notifications";
import { planInitialLineup, type AssignablePlayer } from "@/lib/draft/lineup-assignment";
import { defaultLeagueSettings } from "@/lib/fantasy/defaults";
import { isSlotEligibleForPlayer } from "@/lib/fantasy/roster-validation";
import { nextWaiverProcessingTime } from "@/lib/fantasy/waivers";
import { tradeIssues, votesNeededToReject, type TradeRosterPlayer } from "@/lib/fantasy/trade-evaluation";
import type { TradePlayerSummary, TradeStatus, TradeSummary } from "@/lib/fantasy/trade-types";
import type { LeagueSettings, RosterSlot } from "@/lib/fantasy/types";

export type { TradePlayerSummary, TradeStatus, TradeSummary } from "@/lib/fantasy/trade-types";

export class TradeError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type TradeRow = {
  id: string;
  league_id: string;
  from_team_id: string;
  to_team_id: string;
  offered_player_ids: string[];
  requested_player_ids: string[];
  from_drop_player_ids: string[];
  to_drop_player_ids: string[];
  status: TradeStatus;
  review_ends_at: Date | null;
  created_at: Date;
};

type LeagueContext = {
  leagueId: string;
  settings: LeagueSettings;
  teamCount: number;
};

type ViewerTeamRow = {
  team_id: string;
  is_bot: boolean;
};

/** Rows the viewer manages in this league (a manager has exactly one). */
async function viewerTeams(client: PoolClient, leagueId: string, identity: ApiIdentity): Promise<ViewerTeamRow[]> {
  const result = await client.query<ViewerTeamRow>(
    `select ft.id as team_id, ft.is_bot
     from fantasy_team ft
     join app_user u on u.id = ft.manager_user_id
     where ft.league_id = $1 and (u.id::text = $2 or u.email = $3)`,
    [leagueId, identity.userId, identity.email],
  );
  return result.rows;
}

async function isCommissioner(client: PoolClient, leagueId: string, identity: ApiIdentity): Promise<boolean> {
  const result = await client.query<{ is_commissioner: boolean }>(
    `select
       exists (
         select 1 from league l
         join app_user cu on cu.id = l.commissioner_user_id
         where l.id = $1 and (cu.id::text = $2 or cu.email = $3)
       ) or exists (
         select 1 from league_member lm
         join app_user lu on lu.id = lm.user_id
         where lm.league_id = $1 and lm.role in ('commissioner', 'co_commissioner')
           and (lu.id::text = $2 or lu.email = $3)
       ) as is_commissioner`,
    [leagueId, identity.userId, identity.email],
  );
  return Boolean(result.rows[0]?.is_commissioner);
}

async function getLeagueContext(client: PoolClient, leagueId: string): Promise<LeagueContext> {
  const result = await client.query<{ settings: LeagueSettings; team_count: string | number }>(
    `select l.settings, (select count(*) from fantasy_team ft where ft.league_id = l.id) as team_count
     from league l
     where l.id = $1`,
    [leagueId],
  );
  const row = result.rows[0];

  if (!row) {
    throw new TradeError("League not found.", 404);
  }

  return {
    leagueId,
    settings: { ...defaultLeagueSettings, ...row.settings },
    teamCount: Number(row.team_count),
  };
}

/** Active roster with current position eligibility, for trade validation. */
async function activeRoster(client: PoolClient, teamId: string): Promise<TradeRosterPlayer[]> {
  const result = await client.query<{ player_id: string; positions: RosterSlot[] | null }>(
    `select re.player_id,
       coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
     from roster_entry re
     left join player_position_eligibility ppe on ppe.player_id = re.player_id and ppe.valid_to is null
     where re.team_id = $1 and re.dropped_at is null
     group by re.player_id`,
    [teamId],
  );

  return result.rows.map((row) => ({
    playerId: row.player_id,
    positions: row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[]),
  }));
}

function rosterSlotCounts(settings: LeagueSettings): Record<RosterSlot, number> {
  return settings.rosterSlots;
}

/** Re-check that the swap is still executable against the current rosters. */
async function currentTradeIssues(client: PoolClient, context: LeagueContext, trade: TradeRow): Promise<string[]> {
  const [fromRoster, toRoster] = await Promise.all([
    activeRoster(client, trade.from_team_id),
    activeRoster(client, trade.to_team_id),
  ]);

  return tradeIssues(
    {
      fromRoster,
      toRoster,
      offeredPlayerIds: trade.offered_player_ids,
      requestedPlayerIds: trade.requested_player_ids,
      fromDropPlayerIds: trade.from_drop_player_ids,
      toDropPlayerIds: trade.to_drop_player_ids,
    },
    rosterSlotCounts(context.settings),
  );
}

/**
 * Execute an accepted trade atomically on the caller's transaction: drops
 * release players to free agency, traded players swap teams (old roster row
 * closed, new one inserted as a trade acquisition), lineup rows follow, and
 * each team gets a fantasy_transaction audit row. Re-validates first; a swap
 * that no longer fits marks the trade failed instead of executing.
 */
async function executeTrade(client: PoolClient, context: LeagueContext, trade: TradeRow): Promise<TradeStatus> {
  const issues = await currentTradeIssues(client, context, trade);

  if (issues.length) {
    await client.query(
      `update trade_proposal set status = 'failed', resolved_at = now(), updated_at = now() where id = $1`,
      [trade.id],
    );
    return "failed";
  }

  const moves: Array<{ playerId: string; fromTeamId: string; toTeamId: string }> = [
    ...trade.offered_player_ids.map((playerId) => ({ playerId, fromTeamId: trade.from_team_id, toTeamId: trade.to_team_id })),
    ...trade.requested_player_ids.map((playerId) => ({ playerId, fromTeamId: trade.to_team_id, toTeamId: trade.from_team_id })),
  ];
  const drops: Array<{ playerId: string; teamId: string }> = [
    ...trade.from_drop_player_ids.map((playerId) => ({ playerId, teamId: trade.from_team_id })),
    ...trade.to_drop_player_ids.map((playerId) => ({ playerId, teamId: trade.to_team_id })),
  ];

  const dropClearsAt = nextWaiverProcessingTime(context.settings.waiverProcessingDays ?? [], new Date());

  for (const drop of drops) {
    await client.query(
      `update roster_entry set dropped_at = now(), waiver_until = $3 where team_id = $1 and player_id = $2 and dropped_at is null`,
      [drop.teamId, drop.playerId, dropClearsAt],
    );
    await removeLineupEntry(client, drop.teamId, drop.playerId);
  }

  for (const move of moves) {
    await client.query(`update roster_entry set dropped_at = now() where team_id = $1 and player_id = $2 and dropped_at is null`, [
      move.fromTeamId,
      move.playerId,
    ]);
    await removeLineupEntry(client, move.fromTeamId, move.playerId);
    await client.query(`insert into roster_entry (team_id, player_id, acquisition_type) values ($1, $2, 'trade')`, [
      move.toTeamId,
      move.playerId,
    ]);
  }

  await assignIncomingLineupSlots(client, context, trade.to_team_id, trade.offered_player_ids);
  await assignIncomingLineupSlots(client, context, trade.from_team_id, trade.requested_player_ids);

  await client.query(
    `update trade_proposal set status = 'processed', resolved_at = now(), updated_at = now() where id = $1`,
    [trade.id],
  );

  for (const [teamId, incoming, outgoing, dropped] of [
    [trade.from_team_id, trade.requested_player_ids, trade.offered_player_ids, trade.from_drop_player_ids],
    [trade.to_team_id, trade.offered_player_ids, trade.requested_player_ids, trade.to_drop_player_ids],
  ] as const) {
    await client.query(
      `insert into fantasy_transaction (league_id, team_id, type, status, payload, processed_at)
       values ($1, $2, 'trade', 'processed', $3::jsonb, now())`,
      [context.leagueId, teamId, JSON.stringify({ tradeId: trade.id, incoming, outgoing, dropped })],
    );
    await enqueueNotificationForTeam(client, teamId, {
      type: "trade_review",
      title: "Trade processed",
      body: "A trade involving your team has been processed.",
      url: `/team/${teamId}?tab=league`,
    });
  }

  return "processed";
}

async function removeLineupEntry(client: PoolClient, teamId: string, playerId: string): Promise<void> {
  await client.query(
    `delete from lineup_entry
     where team_id = $1 and player_id = $2
       and lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)`,
    [teamId, playerId],
  );
}

// Active-slot fill order for an incoming player; bench is the fallback.
const incomingSlotOrder: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP", "UTIL", "P", "BN"];

/**
 * Slot incoming players into the receiving team's current lineup: each takes
 * the first eligible slot with spare capacity (bench as fallback). When that
 * greedy pass can't seat someone — the roster fits overall but not without
 * rearranging — the whole day's lineup is re-planned with the same assigner
 * the draft uses, so a processed trade can never leave an illegal lineup.
 */
async function assignIncomingLineupSlots(
  client: PoolClient,
  context: LeagueContext,
  teamId: string,
  incomingPlayerIds: string[],
): Promise<void> {
  if (!incomingPlayerIds.length) {
    return;
  }

  const scoringPeriod = await client.query<{ id: string }>(
    `select id from scoring_period where league_id = $1 and status = 'active' order by starts_at desc limit 1`,
    [context.leagueId],
  );
  const scoringPeriodId = scoringPeriod.rows[0]?.id;

  if (!scoringPeriodId) {
    return;
  }

  const rosterResult = await client.query<{ player_id: string; status: AssignablePlayer["status"]; positions: RosterSlot[] | null }>(
    `select re.player_id, p.status,
       coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
     from roster_entry re
     join player p on p.id = re.player_id
     left join player_position_eligibility ppe on ppe.player_id = re.player_id and ppe.valid_to is null
     where re.team_id = $1 and re.dropped_at is null
     group by re.player_id, p.status`,
    [teamId],
  );
  const rosterPlayers: AssignablePlayer[] = rosterResult.rows.map((row) => ({
    playerId: row.player_id,
    status: row.status,
    positions: row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[]),
  }));
  const playerById = new Map(rosterPlayers.map((player) => [player.playerId, player]));

  const lineupDateResult = await client.query<{ lineup_date: Date | string }>(
    `select coalesce(max(lineup_date), current_date) as lineup_date from lineup_entry where team_id = $1`,
    [teamId],
  );
  const lineupDate = lineupDateResult.rows[0].lineup_date;
  const currentSlots = await client.query<{ slot: RosterSlot; used: string | number }>(
    `select slot, count(*) as used from lineup_entry where team_id = $1 and lineup_date = $2 group by slot`,
    [teamId, lineupDate],
  );
  const limits = rosterSlotCounts(context.settings);
  const used = new Map(currentSlots.rows.map((row) => [row.slot, Number(row.used)]));

  const greedy: Array<{ playerId: string; slot: RosterSlot }> = [];
  let needsReplan = false;

  for (const playerId of incomingPlayerIds) {
    const player = playerById.get(playerId);
    const slot = player
      ? incomingSlotOrder.find(
          (candidate) => isSlotEligibleForPlayer(player, candidate) && (used.get(candidate) ?? 0) < (limits[candidate] ?? 0),
        )
      : undefined;

    if (!slot) {
      needsReplan = true;
      break;
    }

    used.set(slot, (used.get(slot) ?? 0) + 1);
    greedy.push({ playerId, slot });
  }

  const assignments = needsReplan ? planInitialLineup(rosterPlayers, limits) : greedy;

  for (const assignment of assignments) {
    await client.query(
      `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot)
       values ($1, $2, $3, $4, $5)
       on conflict (team_id, player_id, lineup_date)
       do update set slot = excluded.slot`,
      [teamId, assignment.playerId, scoringPeriodId, lineupDate, assignment.slot],
    );
  }
}

/**
 * Lazily resolve accepted trades whose review window has ended, mirroring the
 * draft's lazy clock: every trade read/mutation calls this first, so trades
 * process on the next touch after the window closes with no worker needed.
 */
async function resolveDueTrades(client: PoolClient, leagueId: string): Promise<void> {
  const due = await client.query<TradeRow>(
    `select * from trade_proposal
     where league_id = $1 and status = 'accepted' and review_ends_at <= now()
     for update`,
    [leagueId],
  );

  if (!due.rows.length) {
    return;
  }

  const context = await getLeagueContext(client, leagueId);

  for (const trade of due.rows) {
    await executeTrade(client, context, trade);
  }
}

async function loadTrade(client: PoolClient, leagueId: string, tradeId: string): Promise<TradeRow> {
  const result = await client.query<TradeRow>(`select * from trade_proposal where id = $1 and league_id = $2 for update`, [
    tradeId,
    leagueId,
  ]);
  const trade = result.rows[0];

  if (!trade) {
    throw new TradeError("Trade not found.", 404);
  }

  return trade;
}

export type ProposeTradeInput = {
  fromTeamId: string;
  toTeamId: string;
  offeredPlayerIds: string[];
  requestedPlayerIds: string[];
  fromDropPlayerIds?: string[];
};

export async function proposeTrade(leagueId: string, input: ProposeTradeInput, identity: ApiIdentity): Promise<TradeSummary> {
  return withTradeTransaction(leagueId, identity, async (client, context) => {
    const myTeams = await viewerTeams(client, leagueId, identity);

    if (!myTeams.some((team) => team.team_id === input.fromTeamId)) {
      throw new TradeError("You can only propose trades from a team you manage.", 403);
    }

    const teams = await client.query<{ id: string }>(
      `select id from fantasy_team where league_id = $1 and id = any($2::uuid[])`,
      [leagueId, [input.fromTeamId, input.toTeamId]],
    );

    if (teams.rows.length !== 2) {
      throw new TradeError("Both teams must be in this league.", 422);
    }

    const [fromRoster, toRoster] = await Promise.all([
      activeRoster(client, input.fromTeamId),
      activeRoster(client, input.toTeamId),
    ]);
    const issues = tradeIssues(
      {
        fromRoster,
        toRoster,
        offeredPlayerIds: input.offeredPlayerIds,
        requestedPlayerIds: input.requestedPlayerIds,
        fromDropPlayerIds: input.fromDropPlayerIds ?? [],
        toDropPlayerIds: [],
      },
      rosterSlotCounts(context.settings),
    );

    // The receiving side may still need drops of their own; that's resolved at
    // accept time, so only the proposer-side fit blocks the offer itself.
    const blocking = issues.filter((issue) => !issue.includes("receiving team with more players"));

    if (blocking.length) {
      throw new TradeError(blocking[0], 409);
    }

    const inserted = await client.query<{ id: string }>(
      `insert into trade_proposal
         (league_id, from_team_id, to_team_id, offered_player_ids, requested_player_ids, from_drop_player_ids)
       values ($1, $2, $3, $4::uuid[], $5::uuid[], $6::uuid[])
       returning id`,
      [
        leagueId,
        input.fromTeamId,
        input.toTeamId,
        input.offeredPlayerIds,
        input.requestedPlayerIds,
        input.fromDropPlayerIds ?? [],
      ],
    );

    await enqueueNotificationForTeam(client, input.toTeamId, {
      type: "trade_review",
      title: "New trade offer",
      body: "Another manager has offered you a trade. Review it on the League tab.",
      url: `/team/${input.toTeamId}?tab=league`,
    });

    return inserted.rows[0].id;
  });
}

export type RespondToTradeInput = {
  action: "accept" | "decline";
  toDropPlayerIds?: string[];
};

export async function respondToTrade(
  leagueId: string,
  tradeId: string,
  input: RespondToTradeInput,
  identity: ApiIdentity,
): Promise<TradeSummary> {
  return withTradeTransaction(leagueId, identity, async (client, context) => {
    const trade = await loadTrade(client, leagueId, tradeId);

    if (trade.status !== "proposed") {
      throw new TradeError(`This trade is ${trade.status.replace("_", " ")} and can no longer be responded to.`, 409);
    }

    const myTeams = await viewerTeams(client, leagueId, identity);
    const managesToTeam = myTeams.some((team) => team.team_id === trade.to_team_id);

    // The commissioner may respond for a bot team so bot leagues stay playable.
    const toTeamIsBot = (
      await client.query<{ is_bot: boolean }>(`select is_bot from fantasy_team where id = $1`, [trade.to_team_id])
    ).rows[0]?.is_bot;
    const commissioner = await isCommissioner(client, leagueId, identity);

    if (!managesToTeam && !(commissioner && toTeamIsBot)) {
      throw new TradeError("Only the receiving team's manager can respond to this trade.", 403);
    }

    if (input.action === "decline") {
      await client.query(`update trade_proposal set status = 'declined', resolved_at = now(), updated_at = now() where id = $1`, [
        trade.id,
      ]);
      return trade.id;
    }

    const withDrops: TradeRow = { ...trade, to_drop_player_ids: input.toDropPlayerIds ?? [] };
    const issues = await currentTradeIssues(client, context, withDrops);

    if (issues.length) {
      throw new TradeError(issues[0], 409);
    }

    const reviewDays = context.settings.tradeReview === "none" ? 0 : context.settings.tradeReviewDays;

    await client.query(
      `update trade_proposal
       set status = 'accepted', to_drop_player_ids = $2::uuid[],
           review_ends_at = now() + make_interval(days => $3), updated_at = now()
       where id = $1`,
      [trade.id, input.toDropPlayerIds ?? [], reviewDays],
    );

    if (reviewDays === 0) {
      await executeTrade(client, context, { ...withDrops, status: "accepted" });
    } else {
      await enqueueNotificationForTeam(client, trade.from_team_id, {
        type: "trade_review",
        title: "Trade accepted",
        body: `Your trade offer was accepted and is under league review for ${reviewDays} day${reviewDays === 1 ? "" : "s"}.`,
        url: `/team/${trade.from_team_id}?tab=league`,
      });
    }

    return trade.id;
  });
}

export async function withdrawTrade(leagueId: string, tradeId: string, identity: ApiIdentity): Promise<TradeSummary> {
  return withTradeTransaction(leagueId, identity, async (client) => {
    const trade = await loadTrade(client, leagueId, tradeId);

    if (trade.status !== "proposed") {
      throw new TradeError("Only a pending offer can be withdrawn.", 409);
    }

    const myTeams = await viewerTeams(client, leagueId, identity);

    if (!myTeams.some((team) => team.team_id === trade.from_team_id)) {
      throw new TradeError("Only the proposing team's manager can withdraw this trade.", 403);
    }

    await client.query(`update trade_proposal set status = 'withdrawn', resolved_at = now(), updated_at = now() where id = $1`, [
      trade.id,
    ]);
    return trade.id;
  });
}

export async function voteAgainstTrade(leagueId: string, tradeId: string, identity: ApiIdentity): Promise<TradeSummary> {
  return withTradeTransaction(leagueId, identity, async (client, context) => {
    const trade = await loadTrade(client, leagueId, tradeId);

    if (context.settings.tradeReview !== "league-vote") {
      throw new TradeError("This league does not use league votes for trade review.", 409);
    }

    if (trade.status !== "accepted") {
      throw new TradeError("Votes are only open while an accepted trade is under review.", 409);
    }

    const myTeams = await viewerTeams(client, leagueId, identity);
    const voterTeam = myTeams.find((team) => team.team_id !== trade.from_team_id && team.team_id !== trade.to_team_id);

    if (!voterTeam || myTeams.some((team) => team.team_id === trade.from_team_id || team.team_id === trade.to_team_id)) {
      throw new TradeError("Only managers of teams outside the trade can vote against it.", 403);
    }

    await client.query(
      `insert into trade_vote (trade_id, team_id, voter_user_id)
       values ($1, $2, (select id from app_user where id::text = $3 or email = $4 limit 1))
       on conflict (trade_id, team_id) do nothing`,
      [trade.id, voterTeam.team_id, identity.userId, identity.email],
    );

    const votes = await client.query<{ count: string | number }>(`select count(*) as count from trade_vote where trade_id = $1`, [
      trade.id,
    ]);

    if (Number(votes.rows[0].count) >= votesNeededToReject(context.teamCount)) {
      await client.query(`update trade_proposal set status = 'voted_down', resolved_at = now(), updated_at = now() where id = $1`, [
        trade.id,
      ]);

      for (const teamId of [trade.from_team_id, trade.to_team_id]) {
        await enqueueNotificationForTeam(client, teamId, {
          type: "trade_review",
          title: "Trade rejected by league vote",
          body: "The league voted down a trade involving your team.",
          url: `/team/${teamId}?tab=league`,
        });
      }
    }

    return trade.id;
  });
}

export async function vetoTrade(leagueId: string, tradeId: string, identity: ApiIdentity): Promise<TradeSummary> {
  return withTradeTransaction(leagueId, identity, async (client) => {
    const trade = await loadTrade(client, leagueId, tradeId);

    if (trade.status !== "proposed" && trade.status !== "accepted") {
      throw new TradeError("Only a pending or accepted trade can be vetoed.", 409);
    }

    if (!(await isCommissioner(client, leagueId, identity))) {
      throw new TradeError("Only the commissioner can veto a trade.", 403);
    }

    await client.query(`update trade_proposal set status = 'vetoed', resolved_at = now(), updated_at = now() where id = $1`, [
      trade.id,
    ]);

    for (const teamId of [trade.from_team_id, trade.to_team_id]) {
      await enqueueNotificationForTeam(client, teamId, {
        type: "trade_review",
        title: "Trade vetoed",
        body: "The commissioner vetoed a trade involving your team.",
        url: `/team/${teamId}?tab=league`,
      });
    }

    return trade.id;
  });
}

/**
 * Run a trade mutation: resolve due trades first (lazy processing), do the
 * work, then return the updated summary — all in one transaction.
 */
async function withTradeTransaction(
  leagueId: string,
  identity: ApiIdentity,
  work: (client: PoolClient, context: LeagueContext) => Promise<string>,
): Promise<TradeSummary> {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    // Serialize trade mutations per league; same pattern as lineup saves.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", ["trade:" + leagueId]);
    await resolveDueTrades(client, leagueId);
    const context = await getLeagueContext(client, leagueId);
    const tradeId = await work(client, context);
    const summaries = await queryTradeSummaries(client, leagueId, identity, tradeId);
    await client.query("commit");

    if (!summaries.length) {
      throw new TradeError("Trade not found.", 404);
    }

    return summaries[0];
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listTradesForLeague(leagueId: string, identity: ApiIdentity): Promise<TradeSummary[]> {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", ["trade:" + leagueId]);
    await resolveDueTrades(client, leagueId);
    const summaries = await queryTradeSummaries(client, leagueId, identity);
    await client.query("commit");
    return summaries;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function queryTradeSummaries(
  client: PoolClient,
  leagueId: string,
  identity: ApiIdentity,
  tradeId?: string,
): Promise<TradeSummary[]> {
  const context = await getLeagueContext(client, leagueId);
  const myTeams = await viewerTeams(client, leagueId, identity);
  const commissioner = await isCommissioner(client, leagueId, identity);
  const myTeamIds = new Set(myTeams.map((team) => team.team_id));

  const trades = await client.query<
    TradeRow & { from_team_name: string; to_team_name: string; to_team_is_bot: boolean; votes_against: string | number; viewer_voted: boolean }
  >(
    `select tp.*,
       ft_from.name as from_team_name,
       ft_to.name as to_team_name,
       ft_to.is_bot as to_team_is_bot,
       (select count(*) from trade_vote tv where tv.trade_id = tp.id) as votes_against,
       exists (
         select 1 from trade_vote tv where tv.trade_id = tp.id and tv.team_id = any($3::uuid[])
       ) as viewer_voted
     from trade_proposal tp
     join fantasy_team ft_from on ft_from.id = tp.from_team_id
     join fantasy_team ft_to on ft_to.id = tp.to_team_id
     where tp.league_id = $1 and ($2::uuid is null or tp.id = $2)
     order by tp.created_at desc
     limit 25`,
    [leagueId, tradeId ?? null, [...myTeamIds]],
  );

  if (!trades.rows.length) {
    return [];
  }

  const playerIds = [
    ...new Set(
      trades.rows.flatMap((row) => [
        ...row.offered_player_ids,
        ...row.requested_player_ids,
        ...row.from_drop_player_ids,
        ...row.to_drop_player_ids,
      ]),
    ),
  ];
  const players = await client.query<{ id: string; full_name: string; mlb_team: string | null; positions: RosterSlot[] | null }>(
    `select p.id, p.full_name, mt.abbreviation as mlb_team,
       coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
     from player p
     left join mlb_team mt on mt.id = p.current_mlb_team_id
     left join player_position_eligibility ppe on ppe.player_id = p.id and ppe.valid_to is null
     where p.id = any($1::uuid[])
     group by p.id, mt.abbreviation`,
    [playerIds],
  );
  const playerById = new Map(players.rows.map((row) => [row.id, row]));

  const toSummaries = (ids: string[]): TradePlayerSummary[] =>
    ids.map((id) => {
      const player = playerById.get(id);
      return {
        playerId: id,
        name: player?.full_name ?? "Unknown player",
        positions: player?.positions?.length ? player.positions : (["UTIL"] as RosterSlot[]),
        mlbTeam: player?.mlb_team ?? null,
      };
    });

  const leagueVotes = context.settings.tradeReview === "league-vote";

  return trades.rows.map((row) => {
    const managesFrom = myTeamIds.has(row.from_team_id);
    const managesTo = myTeamIds.has(row.to_team_id);
    const open = row.status === "proposed" || row.status === "accepted";

    return {
      id: row.id,
      status: row.status,
      fromTeam: { id: row.from_team_id, name: row.from_team_name },
      toTeam: { id: row.to_team_id, name: row.to_team_name },
      offered: toSummaries(row.offered_player_ids),
      requested: toSummaries(row.requested_player_ids),
      fromDrops: toSummaries(row.from_drop_player_ids),
      toDrops: toSummaries(row.to_drop_player_ids),
      createdAt: row.created_at.toISOString(),
      reviewEndsAt: row.review_ends_at ? row.review_ends_at.toISOString() : null,
      votesAgainst: Number(row.votes_against),
      votesNeeded: leagueVotes ? votesNeededToReject(context.teamCount) : null,
      viewer: {
        canRespond: row.status === "proposed" && (managesTo || (commissioner && row.to_team_is_bot)),
        canWithdraw: row.status === "proposed" && managesFrom,
        canVote:
          leagueVotes && row.status === "accepted" && !managesFrom && !managesTo && myTeamIds.size > 0 && !row.viewer_voted,
        hasVoted: row.viewer_voted,
        canVeto: commissioner && open,
      },
    };
  });
}
