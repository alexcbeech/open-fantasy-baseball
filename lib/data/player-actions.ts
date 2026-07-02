import { getPool } from "@/lib/db/client";
import { getPlayerDetail } from "@/lib/data/players";
import type { PlayerDetail } from "@/lib/fantasy/types";
import type { PoolClient } from "pg";

export type PlayerManagementAction = "add" | "drop" | "move-to-il" | "move-to-na";

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
};

type PlayerContext = {
  status: PlayerDetail["status"];
};

export async function applyPlayerManagementAction(teamId: string, playerId: string, action: PlayerManagementAction) {
  const client = await getPool().connect();

  try {
    await client.query("begin");

    const team = await getTeamContext(client, teamId);
    const player = await getPlayerContext(client, playerId);

    switch (action) {
      case "add":
        await addPlayer(client, team, teamId, playerId);
        break;
      case "drop":
        await dropPlayer(client, team, teamId, playerId);
        break;
      case "move-to-il":
        if (player.status !== "injured" && player.status !== "day-to-day") {
          throw new PlayerActionError("Only injured or day-to-day players can be moved to IL.", 422);
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
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  const player = await getPlayerDetail(playerId);

  if (!player) {
    throw new PlayerActionError("Player not found after action.", 404);
  }

  return player;
}

async function getTeamContext(client: PoolClient, teamId: string): Promise<TeamContext> {
  const result = await client.query<{ league_id: string }>("select league_id from fantasy_team where id = $1", [teamId]);
  const team = result.rows[0];

  if (!team) {
    throw new PlayerActionError("Team not found.", 404);
  }

  return { leagueId: team.league_id };
}

async function getPlayerContext(client: PoolClient, playerId: string): Promise<PlayerContext> {
  const result = await client.query<{ status: PlayerDetail["status"] }>("select status from player where id = $1", [playerId]);
  const player = result.rows[0];

  if (!player) {
    throw new PlayerActionError("Player not found.", 404);
  }

  return { status: player.status };
}

async function addPlayer(client: PoolClient, team: TeamContext, teamId: string, playerId: string) {
  const activeRoster = await client.query<{ team_id: string }>(
    "select team_id from roster_entry where player_id = $1 and dropped_at is null limit 1",
    [playerId],
  );

  if (activeRoster.rows.length) {
    throw new PlayerActionError("Player is already rostered.", 409);
  }

  await client.query(
    `insert into roster_entry (team_id, player_id, acquisition_type)
     values ($1, $2, 'free_agent')`,
    [teamId, playerId],
  );
  await insertTransaction(client, team, teamId, "add", { playerId });
}

async function dropPlayer(client: PoolClient, team: TeamContext, teamId: string, playerId: string) {
  const result = await client.query(
    `update roster_entry
     set dropped_at = now()
     where team_id = $1 and player_id = $2 and dropped_at is null`,
    [teamId, playerId],
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
