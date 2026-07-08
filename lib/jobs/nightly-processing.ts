import type { PoolClient } from "pg";
import { getPool, isDatabaseConfigured, isUniqueViolation } from "@/lib/db/client";
import { buildWaiverNotification, enqueueNotificationForTeam } from "@/lib/data/notifications";

export const nightlyProcessingTasks = [
  "Lock previous scoring period and finalize matchup snapshots.",
  "Resolve waiver claims by league waiver mode, priority, and FAAB bids.",
  "Apply successful adds, drops, and roster moves with audit records.",
  "Advance waiver priorities when rolling waivers are enabled.",
  "Refresh player availability, IL eligibility, and NA eligibility.",
  "Apply scheduled commissioner setting changes.",
  "Queue notifications for waiver results, trade reviews, injuries, and matchup finals.",
  "Recompute standings, playoff seeds, and roto point totals.",
] as const;

export type NightlyProcessingSummary = {
  jobRunId: string | null;
  startedAt: string;
  finishedAt: string;
  leaguesSeen: number;
  waiverClaimsSeen: number;
  waiverClaimsWon: number;
  waiverClaimsLost: number;
  transactionsCreated: number;
  tasks: typeof nightlyProcessingTasks;
};

type DueWaiverClaimRow = {
  id: string;
  league_id: string;
  team_id: string;
  add_player_id: string;
  drop_player_id: string | null;
  bid_amount: string | number | null;
  priority_at_claim: number | null;
  created_at: Date | string;
  league_settings: Record<string, unknown>;
};

export type WaiverClaimCandidate = {
  id: string;
  leagueId: string;
  teamId: string;
  addPlayerId: string;
  dropPlayerId: string | null;
  bidAmount: number | null;
  priorityAtClaim: number | null;
  createdAt: string;
};

export type WaiverClaimDecision = {
  claimId: string;
  status: "won" | "lost";
  reason: "best_claim" | "lower_priority" | "player_unavailable";
};

export function getNightlyProcessingWindow(timeZone = "America/New_York") {
  return {
    localStartTime: "03:00",
    timeZone,
    expectedDurationMinutes: 30,
  };
}

export function decideWaiverClaimsForPlayer(candidates: WaiverClaimCandidate[], playerAvailable = true): WaiverClaimDecision[] {
  if (!playerAvailable) {
    return candidates.map((candidate) => ({
      claimId: candidate.id,
      status: "lost",
      reason: "player_unavailable",
    }));
  }

  const [winner, ...losers] = [...candidates].sort(compareWaiverClaims);

  return [
    {
      claimId: winner.id,
      status: "won",
      reason: "best_claim",
    },
    ...losers.map((candidate) => ({
      claimId: candidate.id,
      status: "lost" as const,
      reason: "lower_priority" as const,
    })),
  ];
}

export async function runNightlyProcessing(now = new Date()): Promise<NightlyProcessingSummary> {
  const startedAt = new Date();

  if (!isDatabaseConfigured()) {
    return {
      jobRunId: null,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      leaguesSeen: 0,
      waiverClaimsSeen: 0,
      waiverClaimsWon: 0,
      waiverClaimsLost: 0,
      transactionsCreated: 0,
      tasks: nightlyProcessingTasks,
    };
  }

  const client = await getPool().connect();
  let jobRunId: string | null = null;

  try {
    await client.query("begin");
    const jobRun = await client.query<{ id: string }>(
      `insert into background_job_run (job_name, status, details)
       values ('nightly_processing', 'started', $1::jsonb)
       returning id`,
      [JSON.stringify({ tasks: nightlyProcessingTasks, triggeredAt: now.toISOString() })],
    );
    jobRunId = jobRun.rows[0].id;
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    client.release();
    throw error;
  }

  try {
    const summary = await processDueWaivers(client, now, jobRunId);
    const finishedAt = new Date();
    const result: NightlyProcessingSummary = {
      jobRunId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      tasks: nightlyProcessingTasks,
      ...summary,
    };

    await client.query(
      `update background_job_run
       set status = 'succeeded', finished_at = now(), details = $2::jsonb
       where id = $1`,
      [jobRunId, JSON.stringify(result)],
    );

    return result;
  } catch (error) {
    await client.query(
      `update background_job_run
       set status = 'failed', finished_at = now(), details = details || $2::jsonb
       where id = $1`,
      [jobRunId, JSON.stringify({ error: error instanceof Error ? error.message : "Nightly processing failed." })],
    );
    throw error;
  } finally {
    client.release();
  }
}

async function processDueWaivers(client: PoolClient, now: Date, jobRunId: string) {
  await client.query("begin");

  try {
    const dueClaims = await client.query<DueWaiverClaimRow>(
      `select wc.id, wc.league_id, wc.team_id, wc.add_player_id, wc.drop_player_id,
              wc.bid_amount, wc.priority_at_claim, wc.created_at, l.settings as league_settings
       from waiver_claim wc
       join league l on l.id = wc.league_id
       where wc.status = 'pending'
         and wc.process_after <= $1
       order by wc.league_id, wc.add_player_id, wc.created_at
       for update`,
      [now],
    );

    const claims = dueClaims.rows.map(mapWaiverClaim);
    const claimGroups = groupClaimsByPlayer(claims);
    let waiverClaimsWon = 0;
    let waiverClaimsLost = 0;
    let transactionsCreated = 0;

    for (const group of claimGroups) {
      const playerAvailable = await isPlayerAvailable(client, group[0].leagueId, group[0].addPlayerId);
      const decisions = decideWaiverClaimsForPlayer(group, playerAvailable);
      const playerName = await getPlayerName(client, group[0].addPlayerId);

      for (const decision of decisions) {
        const claim = group.find((candidate) => candidate.id === decision.claimId);

        if (!claim) {
          continue;
        }

        await client.query(`update waiver_claim set status = $2 where id = $1`, [claim.id, decision.status]);
        let finalStatus = decision.status;

        if (decision.status === "won") {
          // A concurrent user "add" can roster the player between our
          // availability check and this insert; the roster-exclusivity index
          // rejects the duplicate. Roll back just this claim and mark it lost
          // instead of failing the whole waiver run.
          await client.query("savepoint apply_claim");

          try {
            await applyWinningWaiverClaim(client, claim, jobRunId);
            waiverClaimsWon += 1;
            transactionsCreated += 1;
          } catch (error) {
            if (!isUniqueViolation(error)) {
              throw error;
            }

            await client.query("rollback to savepoint apply_claim");
            await client.query(`update waiver_claim set status = 'lost' where id = $1`, [claim.id]);
            finalStatus = "lost";
            waiverClaimsLost += 1;
          }
        } else {
          waiverClaimsLost += 1;
        }

        // Queue a push for the claiming manager (skipped for bot teams). Runs
        // in this transaction so the notification commits with the result; the
        // send_notifications job delivers it.
        await enqueueNotificationForTeam(
          client,
          claim.teamId,
          buildWaiverNotification(finalStatus, playerName, claim.leagueId),
        );
      }
    }

    await client.query("commit");

    return {
      leaguesSeen: new Set(claims.map((claim) => claim.leagueId)).size,
      waiverClaimsSeen: claims.length,
      waiverClaimsWon,
      waiverClaimsLost,
      transactionsCreated,
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function getPlayerName(client: PoolClient, playerId: string): Promise<string> {
  const result = await client.query<{ full_name: string }>(`select full_name from player where id = $1`, [playerId]);
  return result.rows[0]?.full_name ?? "your claim";
}

async function isPlayerAvailable(client: PoolClient, leagueId: string, playerId: string) {
  const result = await client.query<{ exists: boolean }>(
    `select exists (
       select 1
       from roster_entry re
       join fantasy_team ft on ft.id = re.team_id
       where re.player_id = $1 and re.dropped_at is null and ft.league_id = $2
     )`,
    [playerId, leagueId],
  );

  return !result.rows[0].exists;
}

async function applyWinningWaiverClaim(client: PoolClient, claim: WaiverClaimCandidate, jobRunId: string) {
  if (claim.dropPlayerId) {
    await client.query(
      `update roster_entry
       set dropped_at = now()
       where team_id = $1 and player_id = $2 and dropped_at is null`,
      [claim.teamId, claim.dropPlayerId],
    );
  }

  await client.query(
    `insert into roster_entry (team_id, player_id, acquisition_type)
     values ($1, $2, 'waiver')`,
    [claim.teamId, claim.addPlayerId],
  );

  await client.query(
    `insert into fantasy_transaction (league_id, team_id, type, status, payload, processed_at)
     values ($1, $2, 'waiver', 'processed', $3::jsonb, now())`,
    [
      claim.leagueId,
      claim.teamId,
      JSON.stringify({
        waiverClaimId: claim.id,
        addPlayerId: claim.addPlayerId,
        dropPlayerId: claim.dropPlayerId,
        bidAmount: claim.bidAmount,
        jobRunId,
      }),
    ],
  );
}

function mapWaiverClaim(row: DueWaiverClaimRow): WaiverClaimCandidate {
  return {
    id: row.id,
    leagueId: row.league_id,
    teamId: row.team_id,
    addPlayerId: row.add_player_id,
    dropPlayerId: row.drop_player_id,
    bidAmount: row.bid_amount === null ? null : Number(row.bid_amount),
    priorityAtClaim: row.priority_at_claim,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function groupClaimsByPlayer(claims: WaiverClaimCandidate[]) {
  const groups = new Map<string, WaiverClaimCandidate[]>();

  for (const claim of claims) {
    const key = `${claim.leagueId}:${claim.addPlayerId}`;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }

  return [...groups.values()];
}

function compareWaiverClaims(first: WaiverClaimCandidate, second: WaiverClaimCandidate) {
  const firstBid = first.bidAmount ?? 0;
  const secondBid = second.bidAmount ?? 0;

  if (firstBid !== secondBid) {
    return secondBid - firstBid;
  }

  const firstPriority = first.priorityAtClaim ?? Number.MAX_SAFE_INTEGER;
  const secondPriority = second.priorityAtClaim ?? Number.MAX_SAFE_INTEGER;

  if (firstPriority !== secondPriority) {
    return firstPriority - secondPriority;
  }

  return new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime();
}
