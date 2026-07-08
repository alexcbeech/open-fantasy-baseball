import { randomBytes } from "crypto";
import { z } from "zod";
import { hashToken } from "@/lib/auth/bearer-token";
import { getPool, isUniqueViolation, isUuid, query } from "@/lib/db/client";
import type { PoolClient } from "pg";

export class LeagueInviteError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const leagueInviteCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email address is required.").max(254),
});

export type LeagueInviteSummary = {
  id: string;
  leagueId: string;
  leagueName: string;
  email: string;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
};

export type CreatedLeagueInvite = {
  /** Raw join token — exists only in the email and this one-time response. */
  token: string;
  summary: LeagueInviteSummary;
};

export type PendingLeagueInvite = {
  id: string;
  leagueId: string;
  leagueName: string;
  email: string;
  invitedByName: string;
  expiresAt: string;
  acceptedAt: string | null;
};

const INVITE_TTL_DAYS = 7;

function generateInviteToken() {
  return `ofb_join_${randomBytes(32).toString("base64url")}`;
}

type InviteRow = {
  id: string;
  league_id: string;
  email: string;
  expires_at: Date | string;
  created_at: Date | string;
};

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Confirms the league exists and the identity is its commissioner; returns the league name. */
async function requireCommissioner(
  client: PoolClient,
  leagueId: string,
  identity: { userId: string; email: string },
): Promise<{ leagueName: string }> {
  const result = await client.query<{ league_name: string; is_commissioner: boolean }>(
    `select
       l.name as league_name,
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
  const row = result.rows[0];

  if (!row) {
    throw new LeagueInviteError("League not found.", 404);
  }

  if (!row.is_commissioner) {
    throw new LeagueInviteError("Only the league commissioner can send invites.", 403);
  }

  return { leagueName: row.league_name };
}

/**
 * Create (or replace) a pending invite for an email address. Re-inviting the
 * same address supersedes the previous pending invite so a lost email can be
 * re-sent without waiting out the old token's expiry.
 */
export async function createLeagueInvite(
  leagueId: string,
  email: string,
  inviter: { userId: string; email: string },
): Promise<CreatedLeagueInvite> {
  if (!isUuid(leagueId)) {
    throw new LeagueInviteError("League not found.", 404);
  }

  const client = await getPool().connect();
  const token = generateInviteToken();

  try {
    await client.query("begin");
    const { leagueName } = await requireCommissioner(client, leagueId, inviter);

    const alreadyMember = await client.query(
      `select 1 from fantasy_team t
       join app_user u on u.id = t.manager_user_id
       where t.league_id = $1 and lower(u.email) = $2
       union
       select 1 from league_member lm
       join app_user u on u.id = lm.user_id
       where lm.league_id = $1 and lower(u.email) = $2
       limit 1`,
      [leagueId, email],
    );

    if (alreadyMember.rows.length) {
      throw new LeagueInviteError("That person is already a member of this league.", 409);
    }

    // Supersede any pending invite for this address (see the partial unique
    // index in migration 0012).
    await client.query(
      `delete from league_invite where league_id = $1 and lower(email) = $2 and accepted_at is null`,
      [leagueId, email],
    );

    const inviterResult = await client.query<{ id: string; display_name: string }>(
      `select id, display_name from app_user where email = $1 or id::text = $2 limit 1`,
      [inviter.email, inviter.userId],
    );
    const inviterRow = inviterResult.rows[0];

    if (!inviterRow) {
      throw new LeagueInviteError("Your account could not be resolved.", 401);
    }

    let inserted;

    try {
      inserted = await client.query<InviteRow>(
        `insert into league_invite (league_id, email, token_hash, invited_by_user_id, expires_at)
         values ($1, $2, $3, $4, now() + ($5::int * interval '1 day'))
         returning id, league_id, email, expires_at, created_at`,
        [leagueId, email, hashToken(token), inviterRow.id, INVITE_TTL_DAYS],
      );
    } catch (error) {
      // Two commissioners invited the same address at the same instant; the
      // partial unique index rejected the loser.
      if (isUniqueViolation(error)) {
        throw new LeagueInviteError("An invite for that email is already pending.", 409);
      }

      throw error;
    }

    await client.query("commit");
    const row = inserted.rows[0];

    return {
      token,
      summary: {
        id: row.id,
        leagueId: row.league_id,
        leagueName,
        email: row.email,
        invitedByName: inviterRow.display_name,
        expiresAt: iso(row.expires_at),
        createdAt: iso(row.created_at),
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Look up an invite by its raw token. Returns null for unknown tokens. */
export async function getLeagueInviteByToken(token: string): Promise<PendingLeagueInvite | null> {
  const result = await query<{
    id: string;
    league_id: string;
    league_name: string;
    email: string;
    invited_by_name: string;
    expires_at: Date | string;
    accepted_at: Date | string | null;
  }>(
    `select i.id, i.league_id, l.name as league_name, i.email, u.display_name as invited_by_name,
            i.expires_at, i.accepted_at
     from league_invite i
     join league l on l.id = i.league_id
     join app_user u on u.id = i.invited_by_user_id
     where i.token_hash = $1
     limit 1`,
    [hashToken(token)],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    leagueId: row.league_id,
    leagueName: row.league_name,
    email: row.email,
    invitedByName: row.invited_by_name,
    expiresAt: iso(row.expires_at),
    acceptedAt: row.accepted_at ? iso(row.accepted_at) : null,
  };
}

/** Whether a raw invite token is currently redeemable (used by the sign-up carve-out). */
export async function isInviteTokenRedeemable(token: string, email?: string): Promise<boolean> {
  const invite = await getLeagueInviteByToken(token);

  if (!invite || invite.acceptedAt || new Date(invite.expiresAt).getTime() <= Date.now()) {
    return false;
  }

  return email === undefined || invite.email.toLowerCase() === email.toLowerCase();
}

/**
 * Redeem an invite for the signed-in user: join the league as a manager and
 * get a fantasy team. Single-use — the invite row is locked and marked
 * accepted in the same transaction, so a re-used link fails cleanly.
 */
export async function acceptLeagueInvite(
  token: string,
  user: { email: string; displayName: string },
): Promise<{ leagueId: string; leagueName: string }> {
  const client = await getPool().connect();

  try {
    await client.query("begin");

    const inviteResult = await client.query<{
      id: string;
      league_id: string;
      league_name: string;
      email: string;
      expires_at: Date | string;
      accepted_at: Date | string | null;
    }>(
      `select i.id, i.league_id, l.name as league_name, i.email, i.expires_at, i.accepted_at
       from league_invite i
       join league l on l.id = i.league_id
       where i.token_hash = $1
       for update of i`,
      [hashToken(token)],
    );
    const invite = inviteResult.rows[0];

    if (!invite) {
      throw new LeagueInviteError("This invite link is not valid.", 404);
    }

    if (invite.accepted_at) {
      throw new LeagueInviteError("This invite has already been used.", 409);
    }

    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      throw new LeagueInviteError("This invite has expired. Ask the commissioner for a new one.", 410);
    }

    if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new LeagueInviteError(`This invite was sent to ${invite.email}. Sign in with that email to accept it.`, 403);
    }

    // The signed-in user exists in app_user via ensureOfbUserForNeonAuth, but
    // that upsert tolerates DB blips — resolve-or-create here so the join
    // never dangles.
    const userResult = await client.query<{ id: string }>(
      `insert into app_user (email, display_name)
       values ($1, $2)
       on conflict (email) do update set updated_at = now()
       returning id`,
      [user.email, user.displayName],
    );
    const userId = userResult.rows[0].id;

    await client.query(
      `insert into league_member (league_id, user_id, role)
       values ($1, $2, 'manager')
       on conflict (league_id, user_id) do nothing`,
      [invite.league_id, userId],
    );

    // Give the new manager a team if they don't have one; fantasy_team names
    // are unique per league, so suffix until one fits.
    const existingTeam = await client.query<{ id: string }>(
      `select id from fantasy_team where league_id = $1 and manager_user_id = $2 and is_bot = false limit 1`,
      [invite.league_id, userId],
    );

    if (!existingTeam.rows[0]) {
      const baseName = `${user.displayName}'s Team`.slice(0, 80);

      for (let suffix = 0; ; suffix++) {
        const name = suffix === 0 ? baseName : `${baseName} ${suffix + 1}`;

        try {
          await client.query(`savepoint team_name`);
          await client.query(`insert into fantasy_team (league_id, manager_user_id, name) values ($1, $2, $3)`, [
            invite.league_id,
            userId,
            name,
          ]);
          break;
        } catch (error) {
          if (isUniqueViolation(error) && suffix < 20) {
            await client.query(`rollback to savepoint team_name`);
            continue;
          }

          throw error;
        }
      }
    }

    await client.query(`update league_invite set accepted_at = now(), accepted_by_user_id = $2 where id = $1`, [
      invite.id,
      userId,
    ]);

    await client.query("commit");

    return { leagueId: invite.league_id, leagueName: invite.league_name };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
