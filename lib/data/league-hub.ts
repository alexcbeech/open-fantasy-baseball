import type { PoolClient } from "pg";
import type { ApiIdentity } from "@/lib/auth/api-identity";
import { getPool, query } from "@/lib/db/client";
import type { LeagueAnnouncement, LeagueMilestones } from "@/lib/fantasy/types";

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  author_name: string;
  published_at: Date;
  updated_at: Date;
};

type MilestoneRow = {
  draft_at: Date | null;
  trade_deadline_at: Date | null;
  regular_season_ends_at: Date | null;
  playoffs_start_at: Date | null;
  championship_starts_at: Date | null;
  championship_ends_at: Date | null;
};

export class LeagueHubError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function mapAnnouncement(row: AnnouncementRow): LeagueAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    isPinned: row.is_pinned,
    authorName: row.author_name,
    publishedAt: row.published_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** League dates come from their operational sources so the hub cannot drift. */
export async function getLeagueHubDetails(
  leagueId: string,
): Promise<{ milestones: LeagueMilestones; announcements: LeagueAnnouncement[] }> {
  const [milestoneResult, announcementResult] = await Promise.all([
    query<MilestoneRow>(
      `select
         d.scheduled_start_at as draft_at,
         l.trade_deadline_at,
         (select max(sp.ends_at) from scoring_period sp where sp.league_id = l.id and not sp.is_playoff)
           as regular_season_ends_at,
         (select min(sp.starts_at) from scoring_period sp where sp.league_id = l.id and sp.is_playoff)
           as playoffs_start_at,
         (select sp.starts_at from scoring_period sp
          where sp.league_id = l.id and sp.is_playoff order by sp.playoff_round desc limit 1)
           as championship_starts_at,
         (select sp.ends_at from scoring_period sp
          where sp.league_id = l.id and sp.is_playoff order by sp.playoff_round desc limit 1)
           as championship_ends_at
       from league l
       left join draft d on d.league_id = l.id
       where l.id = $1`,
      [leagueId],
    ),
    query<AnnouncementRow>(
      `select la.id, la.title, la.body, la.is_pinned,
         u.display_name as author_name, la.published_at, la.updated_at
       from league_announcement la
       join app_user u on u.id = la.author_user_id
       where la.league_id = $1 and la.archived_at is null
       order by la.is_pinned desc, la.published_at desc
       limit 6`,
      [leagueId],
    ),
  ]);
  const row = milestoneResult.rows[0];

  return {
    milestones: {
      draftAt: toIso(row?.draft_at),
      tradeDeadlineAt: toIso(row?.trade_deadline_at),
      regularSeasonEndsAt: toIso(row?.regular_season_ends_at),
      playoffsStartAt: toIso(row?.playoffs_start_at),
      championshipStartsAt: toIso(row?.championship_starts_at),
      championshipEndsAt: toIso(row?.championship_ends_at),
    },
    announcements: announcementResult.rows.map(mapAnnouncement),
  };
}

export async function updateLeagueTradeDeadline(leagueId: string, deadline: Date | null): Promise<string | null> {
  const result = await query<{ trade_deadline_at: Date | null }>(
    `update league set trade_deadline_at = $2, updated_at = now() where id = $1 returning trade_deadline_at`,
    [leagueId, deadline],
  );

  if (!result.rows[0]) {
    throw new LeagueHubError("League not found.", 404);
  }

  return toIso(result.rows[0].trade_deadline_at);
}

async function authorId(client: PoolClient, identity: ApiIdentity): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from app_user where id::text = $1 or lower(email) = lower($2) limit 1`,
    [identity.userId, identity.email],
  );

  if (!result.rows[0]) {
    throw new LeagueHubError("Your league profile could not be found.", 403);
  }

  return result.rows[0].id;
}

async function unpinAnnouncements(client: PoolClient, leagueId: string, exceptId?: string): Promise<void> {
  await client.query(
    `update league_announcement
     set is_pinned = false, updated_at = now()
     where league_id = $1 and is_pinned and archived_at is null and ($2::uuid is null or id <> $2)`,
    [leagueId, exceptId ?? null],
  );
}

export async function createLeagueAnnouncement(
  leagueId: string,
  input: { title: string; body: string; isPinned: boolean },
  identity: ApiIdentity,
): Promise<LeagueAnnouncement> {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`announcement:${leagueId}`]);

    if (input.isPinned) {
      await unpinAnnouncements(client, leagueId);
    }

    const userId = await authorId(client, identity);
    const result = await client.query<AnnouncementRow>(
      `with inserted as (
         insert into league_announcement (league_id, author_user_id, title, body, is_pinned)
         values ($1, $2, $3, $4, $5)
         returning id, author_user_id, title, body, is_pinned, published_at, updated_at
       )
       select i.id, i.title, i.body, i.is_pinned, u.display_name as author_name,
         i.published_at, i.updated_at
       from inserted i
       join app_user u on u.id = i.author_user_id`,
      [leagueId, userId, input.title, input.body, input.isPinned],
    );
    await client.query("commit");
    return mapAnnouncement(result.rows[0]);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function setLeagueAnnouncementPinned(
  leagueId: string,
  announcementId: string,
  isPinned: boolean,
): Promise<LeagueAnnouncement> {
  const client = await getPool().connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`announcement:${leagueId}`]);

    if (isPinned) {
      await unpinAnnouncements(client, leagueId, announcementId);
    }

    const result = await client.query<AnnouncementRow>(
      `update league_announcement la
       set is_pinned = $3, updated_at = now()
       from app_user u
       where la.id = $2 and la.league_id = $1 and la.archived_at is null and u.id = la.author_user_id
       returning la.id, la.title, la.body, la.is_pinned, u.display_name as author_name,
         la.published_at, la.updated_at`,
      [leagueId, announcementId, isPinned],
    );

    if (!result.rows[0]) {
      throw new LeagueHubError("Announcement not found.", 404);
    }

    await client.query("commit");
    return mapAnnouncement(result.rows[0]);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveLeagueAnnouncement(leagueId: string, announcementId: string): Promise<void> {
  const result = await query(
    `update league_announcement
     set archived_at = now(), is_pinned = false, updated_at = now()
     where id = $2 and league_id = $1 and archived_at is null`,
    [leagueId, announcementId],
  );

  if (!result.rowCount) {
    throw new LeagueHubError("Announcement not found.", 404);
  }
}
