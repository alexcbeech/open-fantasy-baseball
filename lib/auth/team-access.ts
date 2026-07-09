import { NextResponse } from "next/server";
import { isDatabaseConfigured, isUuid, query } from "@/lib/db/client";
import type { ApiIdentity } from "@/lib/auth/api-identity";

export type TeamAccessLevel = "manager" | "member" | "none" | "not-found";

type TeamAccessRow = {
  found: boolean;
  is_manager: boolean;
  is_commissioner: boolean;
  is_member: boolean;
};

/**
 * How the identity relates to a team. "manager" also covers the league
 * commissioner (who may act on any team); "member" means the identity manages
 * some team in the same league (opponents may view each other). The demo user
 * has a non-UUID id, so identity matching accepts id or email.
 *
 * Demo mode (no database) serves shared mock data with nothing per-user to
 * protect, so callers should skip these checks when the DB is unconfigured.
 */
export async function getTeamAccess(teamId: string, identity: ApiIdentity): Promise<TeamAccessLevel> {
  if (!isUuid(teamId)) {
    return "not-found";
  }

  const result = await query<TeamAccessRow>(
    `select
       exists (select 1 from fantasy_team t where t.id = $1) as found,
       exists (
         select 1 from fantasy_team t
         join app_user u on u.id = t.manager_user_id
         where t.id = $1 and (u.id::text = $2 or u.email = $3)
       ) as is_manager,
       exists (
         select 1 from fantasy_team t
         join league l on l.id = t.league_id
         join app_user cu on cu.id = l.commissioner_user_id
         where t.id = $1 and (cu.id::text = $2 or cu.email = $3)
       ) as is_commissioner,
       exists (
         select 1 from fantasy_team t
         join fantasy_team mine on mine.league_id = t.league_id
         join app_user mu on mu.id = mine.manager_user_id
         where t.id = $1 and (mu.id::text = $2 or mu.email = $3)
       ) or exists (
         select 1 from fantasy_team t
         join league_member lm on lm.league_id = t.league_id
         join app_user lu on lu.id = lm.user_id
         where t.id = $1 and (lu.id::text = $2 or lu.email = $3)
       ) as is_member`,
    [teamId, identity.userId, identity.email],
  );
  const row = result.rows[0];

  if (!row?.found) {
    return "not-found";
  }

  if (row.is_manager || row.is_commissioner) {
    return "manager";
  }

  return row.is_member ? "member" : "none";
}

/** Whether the identity is the league's commissioner (or a co-commissioner). */
export async function isLeagueCommissioner(leagueId: string, identity: ApiIdentity): Promise<boolean> {
  if (!isDatabaseConfigured() || !isUuid(leagueId)) {
    return false;
  }

  const result = await query<{ is_commissioner: boolean }>(
    `select
       exists (
         select 1 from app_user cu
         where cu.id = l.commissioner_user_id and (cu.id::text = $2 or cu.email = $3)
       ) or exists (
         select 1 from league_member lm
         join app_user lu on lu.id = lm.user_id
         where lm.league_id = l.id and lm.role in ('commissioner', 'co_commissioner')
           and (lu.id::text = $2 or lu.email = $3)
       ) as is_commissioner
     from league l
     where l.id = $1`,
    [leagueId, identity.userId, identity.email],
  );

  return Boolean(result.rows[0]?.is_commissioner);
}

export async function getLeagueAccess(leagueId: string, identity: ApiIdentity): Promise<"member" | "none" | "not-found"> {
  if (!isUuid(leagueId)) {
    return "not-found";
  }

  const result = await query<{ found: boolean; is_member: boolean }>(
    `select
       exists (select 1 from league l where l.id = $1) as found,
       exists (
         select 1 from league l
         join app_user cu on cu.id = l.commissioner_user_id
         where l.id = $1 and (cu.id::text = $2 or cu.email = $3)
       ) or exists (
         select 1 from fantasy_team t
         join app_user mu on mu.id = t.manager_user_id
         where t.league_id = $1 and (mu.id::text = $2 or mu.email = $3)
       ) or exists (
         select 1 from league_member lm
         join app_user lu on lu.id = lm.user_id
         where lm.league_id = $1 and (lu.id::text = $2 or lu.email = $3)
       ) as is_member`,
    [leagueId, identity.userId, identity.email],
  );
  const row = result.rows[0];

  if (!row?.found) {
    return "not-found";
  }

  return row.is_member ? "member" : "none";
}

/** 404/403 guard for routes that mutate a team. Null means allowed. */
export async function requireTeamManager(teamId: string, identity: ApiIdentity): Promise<NextResponse | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const access = await getTeamAccess(teamId, identity);

  if (access === "not-found") {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (access !== "manager") {
    return NextResponse.json({ error: "You do not manage this team." }, { status: 403 });
  }

  return null;
}

/** 404/403 guard for routes that read a team. Null means allowed. */
export async function requireTeamViewer(teamId: string, identity: ApiIdentity): Promise<NextResponse | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const access = await getTeamAccess(teamId, identity);

  if (access === "not-found") {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  if (access === "none") {
    return NextResponse.json({ error: "You are not a member of this league." }, { status: 403 });
  }

  return null;
}

/** 404/403 guard for routes that read league data. Null means allowed. */
export async function requireLeagueViewer(leagueId: string, identity: ApiIdentity): Promise<NextResponse | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const access = await getLeagueAccess(leagueId, identity);

  if (access === "not-found") {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  if (access === "none") {
    return NextResponse.json({ error: "You are not a member of this league." }, { status: 403 });
  }

  return null;
}
