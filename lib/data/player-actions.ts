import { getPool, isUniqueViolation } from "@/lib/db/client";
import { getPlayerDetail } from "@/lib/data/players";
import { rosterFits } from "@/lib/draft/lineup-assignment";
import { isSlotEligibleForPlayer } from "@/lib/fantasy/roster-validation";
import { nextWaiverProcessingTime } from "@/lib/fantasy/waivers";
import type { LeagueSettings, PlayerDetail, RosterSlot } from "@/lib/fantasy/types";
import type { PoolClient } from "pg";

export type PlayerManagementAction = "add" | "drop" | "move-to-il" | "move-to-na" | "claim" | "cancel-claim";

export type PlayerActionOptions = {
  /** FAAB bid for a waiver claim; ignored in rolling-priority leagues. */
  bid?: number;
  /** Roster-room drop executed if the waiver claim wins. */
  dropPlayerId?: string;
};

export class PlayerActionError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type TeamContext = {
  leagueId: string;
  settings: LeagueSettings;
};

type PlayerContext = {
  status: PlayerDetail["status"];
};

export async function applyPlayerManagementAction(
  teamId: string,
  playerId: string,
  action: PlayerManagementAction,
  options: PlayerActionOptions = {},
) {
  const client = await getPool().connect();

  try {
    await client.query("begin");

    const team = await getTeamContext(client, teamId);
    const player = await getPlayerContext(client, playerId);

    switch (action) {
      case "add":
        await addPlayer(client, team, teamId, playerId, player, options);
        break;
      case "drop":
        await dropPlayer(client, team, teamId, playerId);
        break;
      case "claim":
        await claimPlayer(client, team, teamId, playerId, options);
        break;
      case "cancel-claim":
        await cancelClaim(client, teamId, playerId);
        break;
      case "move-to-il":
        if (player.status !== "injured" && player.status !== "day-to-day") {
          throw new PlayerActionError("Only injured or day-to-day players can be moved to IL.", 422);
        }
        // IL+ leagues accept day-to-day players; strict IL requires a real
        // injury designation.
        if (player.status === "day-to-day" && !team.settings.allowILPlus) {
          throw new PlayerActionError("Day-to-day players need IL+ slots, which this league has disabled.", 422);
        }
        await movePlayerToSlot(client, team, teamId, playerId, "IL");
        break;
      case "move-to-na":
        if (player.status !== "minors") {
          throw new PlayerActionError("Only minor-league players can be moved to NA.", 422);
        }
        await movePlayerToSlot(client, team, teamId, playerId, "NA");
        break;
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // Refresh with the team context so the returned management flags reflect the
  // player's post-action membership on this team.
  const player = await getPlayerDetail(playerId, teamId);

  if (!player) {
    throw new PlayerActionError("Player not found after action.", 404);
  }

  return player;
}

async function getTeamContext(client: PoolClient, teamId: string): Promise<TeamContext> {
  const result = await client.query<{ league_id: string; settings: LeagueSettings }>(
    `select ft.league_id, l.settings
     from fantasy_team ft
     join league l on l.id = ft.league_id
     where ft.id = $1`,
    [teamId],
  );
  const team = result.rows[0];

  if (!team) {
    throw new PlayerActionError("Team not found.", 404);
  }

  return { leagueId: team.league_id, settings: team.settings };
}

/** When the player's current waiver window in this league ends, if any. */
async function waiverUntil(client: PoolClient, leagueId: string, playerId: string): Promise<Date | null> {
  const result = await client.query<{ waiver_until: Date | null }>(
    `select max(waiver_until) as waiver_until
     from roster_entry
     where league_id = $1 and player_id = $2 and dropped_at is not null and waiver_until > now()`,
    [leagueId, playerId],
  );
  return result.rows[0]?.waiver_until ?? null;
}

async function getPlayerContext(client: PoolClient, playerId: string): Promise<PlayerContext> {
  const result = await client.query<{ status: PlayerDetail["status"] }>("select status from player where id = $1", [playerId]);
  const player = result.rows[0];

  if (!player) {
    throw new PlayerActionError("Player not found.", 404);
  }

  return { status: player.status };
}

async function addPlayer(
  client: PoolClient,
  team: TeamContext,
  teamId: string,
  playerId: string,
  player: PlayerContext,
  options: PlayerActionOptions,
) {
  const activeRoster = await client.query<{ team_id: string }>(
    `select re.team_id
     from roster_entry re
     join fantasy_team ft on ft.id = re.team_id
     where re.player_id = $1 and re.dropped_at is null and ft.league_id = $2
     limit 1`,
    [playerId, team.leagueId],
  );

  if (activeRoster.rows.length) {
    throw new PlayerActionError("Player is already rostered.", 409);
  }

  // A recently dropped player clears waivers first; adds must go through a
  // claim so every team gets a shot at them.
  const onWaiversUntil = await waiverUntil(client, team.leagueId, playerId);

  if (onWaiversUntil) {
    throw new PlayerActionError("Player is on waivers. Place a waiver claim instead.", 409);
  }

  await assertPostActionRosterFits(
    client,
    team,
    teamId,
    playerId,
    options.dropPlayerId,
    "Your roster is full. Choose a player to drop with this add.",
  );

  // The named drop happens in the same transaction, so the add can never
  // overfill the roster and the drop can never orphan without its add.
  if (options.dropPlayerId) {
    await dropPlayer(client, team, teamId, options.dropPlayerId);
  }

  try {
    await client.query(
      `insert into roster_entry (team_id, player_id, acquisition_type)
       values ($1, $2, 'free_agent')`,
      [teamId, playerId],
    );
  } catch (error) {
    // Unique-violation from idx_roster_entry_active_player_per_league: a
    // concurrent transaction rostered the player between our check and insert.
    if (isUniqueViolation(error)) {
      throw new PlayerActionError("Player is already rostered.", 409);
    }

    throw error;
  }
  // An added player joins today's lineup immediately: the first open eligible
  // active slot if one exists, otherwise the bench.
  const slot = await assignLineupSlotForAdd(client, team, teamId, playerId, player);
  await insertTransaction(client, team, teamId, "add", { playerId, slot });
}

// Active-slot fill order for a newly added player; bench is the fallback.
const addSlotOrder: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "SP", "RP", "UTIL", "P"];

/**
 * Put a just-added player into the team's current lineup: the first eligible
 * active slot with spare capacity, else BN. Skipped (roster-only add) when the
 * league has no scoring period to attach a lineup row to.
 */
export async function assignLineupSlotForAdd(
  client: PoolClient,
  team: Pick<TeamContext, "leagueId">,
  teamId: string,
  playerId: string,
  player: PlayerContext,
): Promise<RosterSlot | null> {
  const scoringPeriod = await client.query<{ id: string }>(
    `select id
     from scoring_period
     where league_id = $1 and status = 'active'
     order by starts_at desc
     limit 1`,
    [team.leagueId],
  );
  const scoringPeriodId = scoringPeriod.rows[0]?.id;

  if (!scoringPeriodId) {
    return null;
  }

  // Sequential on the caller's client: pg serializes per-connection queries
  // and warns on overlapping query() calls inside a transaction.
  const positionsResult = await client.query<{ position: RosterSlot }>(
    "select position from player_position_eligibility where player_id = $1 and valid_to is null",
    [playerId],
  );
  const limitsResult = await client.query<{ slot: RosterSlot; count: number | string }>(
    "select slot, count from league_roster_slot where league_id = $1",
    [team.leagueId],
  );
  const lineupDateResult = await client.query<{ lineup_date: Date | string }>(
    "select coalesce(max(lineup_date), current_date) as lineup_date from lineup_entry where team_id = $1",
    [teamId],
  );
  const lineupDate = lineupDateResult.rows[0].lineup_date;
  const usageResult = await client.query<{ slot: RosterSlot; used: number | string }>(
    "select slot, count(*) as used from lineup_entry where team_id = $1 and lineup_date = $2 group by slot",
    [teamId, lineupDate],
  );

  const eligibility = {
    positions: positionsResult.rows.map((row) => row.position),
    status: player.status,
  };
  const limits = new Map(limitsResult.rows.map((row) => [row.slot, Number(row.count)]));
  const used = new Map(usageResult.rows.map((row) => [row.slot, Number(row.used)]));

  const slot =
    addSlotOrder.find(
      (candidate) =>
        isSlotEligibleForPlayer(eligibility, candidate) && (used.get(candidate) ?? 0) < (limits.get(candidate) ?? 0),
    ) ?? "BN";

  await client.query(
    `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot)
     values ($1, $2, $3, $4, $5)
     on conflict (team_id, player_id, lineup_date)
     do update set slot = excluded.slot`,
    [teamId, playerId, scoringPeriodId, lineupDate, slot],
  );

  return slot;
}

async function dropPlayer(client: PoolClient, team: TeamContext, teamId: string, playerId: string) {
  // Dropped players sit on waivers until the league's next processing time,
  // so a hot drop can't be instantly re-added by whoever refreshes first.
  const clearsAt = nextWaiverProcessingTime(team.settings.waiverProcessingDays ?? [], new Date());
  const result = await client.query(
    `update roster_entry
     set dropped_at = now(), waiver_until = $3
     where team_id = $1 and player_id = $2 and dropped_at is null`,
    [teamId, playerId, clearsAt],
  );

  if (!result.rowCount) {
    throw new PlayerActionError("Player is not on this roster.", 409);
  }

  await client.query(
    `delete from lineup_entry
     where team_id = $1
       and player_id = $2
       and lineup_date = (select max(lineup_date) from lineup_entry where team_id = $1)`,
    [teamId, playerId],
  );
  await insertTransaction(client, team, teamId, "drop", { playerId });
}

/**
 * Place a waiver claim on a player currently clearing waivers. FAAB leagues
 * bid from their remaining budget; rolling leagues use waiver priority. The
 * claim must fit the roster — a full roster requires naming a drop — and it
 * processes at the player's waiver-clear time.
 */
async function claimPlayer(client: PoolClient, team: TeamContext, teamId: string, playerId: string, options: PlayerActionOptions) {
  const onWaiversUntil = await waiverUntil(client, team.leagueId, playerId);

  if (!onWaiversUntil) {
    throw new PlayerActionError("Player is not on waivers. Add them directly instead.", 409);
  }

  const teamRow = await client.query<{ waiver_priority: number | null; faab_remaining: string | number | null }>(
    `select waiver_priority, faab_remaining from fantasy_team where id = $1`,
    [teamId],
  );
  const faabMode = team.settings.waiverMode === "faab";
  const bid = faabMode ? Math.max(0, Math.floor(options.bid ?? 0)) : null;

  if (faabMode) {
    const remaining = Number(teamRow.rows[0]?.faab_remaining ?? 0);

    if ((bid ?? 0) > remaining) {
      throw new PlayerActionError(`Bid exceeds your remaining FAAB budget ($${remaining}).`, 422);
    }
  }

  // The winning claim must produce a legal roster: adding without room
  // requires a drop named up front.
  await assertPostActionRosterFits(
    client,
    team,
    teamId,
    playerId,
    options.dropPlayerId,
    "Your roster has no room for this claim. Choose a player to drop with it.",
  );

  try {
    await client.query(
      `insert into waiver_claim (league_id, team_id, add_player_id, drop_player_id, bid_amount, priority_at_claim, process_after)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [team.leagueId, teamId, playerId, options.dropPlayerId ?? null, bid, teamRow.rows[0]?.waiver_priority ?? null, onWaiversUntil],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PlayerActionError("You already have a pending claim for this player.", 409);
    }

    throw error;
  }
}

/**
 * Assert that the team's active roster — minus the optional named drop, plus
 * the incoming player — can still be legally seated. Shared by direct adds
 * and waiver claims; also validates the named drop is actually rostered.
 */
async function assertPostActionRosterFits(
  client: PoolClient,
  team: TeamContext,
  teamId: string,
  incomingPlayerId: string,
  dropPlayerId: string | undefined,
  noRoomMessage: string,
) {
  const roster = await client.query<{ player_id: string; positions: RosterSlot[] | null }>(
    `select re.player_id,
       coalesce(array_agg(distinct ppe.position) filter (where ppe.position is not null), '{}') as positions
     from roster_entry re
     left join player_position_eligibility ppe on ppe.player_id = re.player_id and ppe.valid_to is null
     where re.team_id = $1 and re.dropped_at is null
     group by re.player_id`,
    [teamId],
  );

  if (dropPlayerId && !roster.rows.some((row) => row.player_id === dropPlayerId)) {
    throw new PlayerActionError("The player to drop is not on your roster.", 409);
  }

  const incomingPositions = await client.query<{ position: RosterSlot }>(
    `select position from player_position_eligibility where player_id = $1 and valid_to is null`,
    [incomingPlayerId],
  );
  const postAction = [
    ...roster.rows
      .filter((row) => row.player_id !== dropPlayerId)
      .map((row) => (row.positions?.length ? row.positions : (["UTIL"] as RosterSlot[]))),
    incomingPositions.rows.length ? incomingPositions.rows.map((row) => row.position) : (["UTIL"] as RosterSlot[]),
  ];

  if (!rosterFits(postAction, team.settings.rosterSlots)) {
    throw new PlayerActionError(noRoomMessage, 409);
  }
}

async function cancelClaim(client: PoolClient, teamId: string, playerId: string) {
  const result = await client.query(
    `update waiver_claim set status = 'canceled' where team_id = $1 and add_player_id = $2 and status = 'pending'`,
    [teamId, playerId],
  );

  if (!result.rowCount) {
    throw new PlayerActionError("No pending claim to cancel.", 409);
  }
}

async function movePlayerToSlot(client: PoolClient, team: TeamContext, teamId: string, playerId: string, slot: "IL" | "NA") {
  const rostered = await client.query(
    "select 1 from roster_entry where team_id = $1 and player_id = $2 and dropped_at is null limit 1",
    [teamId, playerId],
  );

  if (!rostered.rows.length) {
    throw new PlayerActionError("Player must be rostered before changing lineup slot.", 409);
  }

  const slotCount = await client.query<{ count: number | string }>(
    "select count from league_roster_slot where league_id = $1 and slot = $2",
    [team.leagueId, slot],
  );

  if (Number(slotCount.rows[0]?.count ?? 0) <= 0) {
    throw new PlayerActionError(`${slot} slots are not enabled for this league.`, 422);
  }

  const scoringPeriod = await client.query<{ id: string }>(
    `select id
     from scoring_period
     where league_id = $1 and status = 'active'
     order by starts_at desc
     limit 1`,
    [team.leagueId],
  );
  const scoringPeriodId = scoringPeriod.rows[0]?.id;

  if (!scoringPeriodId) {
    throw new PlayerActionError("No active scoring period is available.", 409);
  }

  const latestLineupDate = await client.query<{ lineup_date: Date | string }>(
    "select coalesce(max(lineup_date), current_date) as lineup_date from lineup_entry where team_id = $1",
    [teamId],
  );
  const lineupDate = latestLineupDate.rows[0].lineup_date;

  await client.query(
    `insert into lineup_entry (team_id, player_id, scoring_period_id, lineup_date, slot)
     values ($1, $2, $3, $4, $5)
     on conflict (team_id, player_id, lineup_date)
     do update set slot = excluded.slot`,
    [teamId, playerId, scoringPeriodId, lineupDate, slot],
  );
  await insertTransaction(client, team, teamId, "lineup_change", { playerId, slot });
}

async function insertTransaction(
  client: PoolClient,
  team: TeamContext,
  teamId: string,
  type: "add" | "drop" | "lineup_change",
  payload: Record<string, unknown>,
) {
  await client.query(
    `insert into fantasy_transaction (league_id, team_id, type, status, payload, processed_at)
     values ($1, $2, $3, 'processed', $4::jsonb, now())`,
    [team.leagueId, teamId, type, JSON.stringify(payload)],
  );
}
