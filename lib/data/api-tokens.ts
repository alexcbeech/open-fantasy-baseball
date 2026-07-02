import { randomBytes } from "crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { hashToken } from "@/lib/auth/bearer-token";
import { oauthScopes } from "@/lib/auth/scopes";
import { getPool, query, tryDatabase } from "@/lib/db/client";
import { demoUserEmail } from "@/lib/data/profile";
import type { OAuthScope } from "@/lib/auth/scopes";

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(1, "Token name is required.").max(80, "Token name is too long."),
  scopes: z.array(z.enum(oauthScopes)).min(1, "Select at least one scope."),
  expiresInDays: z.coerce.number().int().min(1).max(365),
});

export type ApiTokenCreateInput = z.infer<typeof apiTokenCreateSchema>;

export type ApiTokenSummary = {
  id: string;
  name: string;
  scopes: OAuthScope[];
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
};

export type CreatedApiToken = {
  token: string;
  summary: ApiTokenSummary;
};

type ApiTokenRow = {
  id: string;
  name: string;
  scopes: OAuthScope[];
  expires_at: Date | string;
  created_at: Date | string;
  revoked_at: Date | string | null;
};

function toIsoDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapToken(row: ApiTokenRow): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes,
    expiresAt: toIsoDate(row.expires_at),
    createdAt: toIsoDate(row.created_at),
    revokedAt: row.revoked_at ? toIsoDate(row.revoked_at) : null,
  };
}

function generateToken() {
  return `ofb_${randomBytes(32).toString("base64url")}`;
}

async function ensureDemoUser(client: PoolClient, email: string) {
  const result = await client.query<{ id: string }>(
    `insert into app_user (email, display_name)
     values ($1, 'Alex')
     on conflict (email) do update set email = excluded.email
     returning id`,
    [email],
  );

  return result.rows[0].id;
}

export async function listApiTokens(email = demoUserEmail) {
  return tryDatabase(
    async () => {
      const result = await query<ApiTokenRow>(
        `select t.id, c.name, t.scopes, t.expires_at, t.created_at, t.revoked_at
         from oauth_access_token t
         join oauth_client c on c.id = t.client_id
         join app_user u on u.id = t.user_id
         where u.email = $1
           and t.revoked_at is null
           and t.expires_at > now()
         order by t.created_at desc`,
        [email],
      );

      return result.rows.map(mapToken);
    },
    () => [],
  );
}

export async function createApiToken(input: ApiTokenCreateInput, email = demoUserEmail): Promise<CreatedApiToken> {
  return tryDatabase(
    async () => {
      const pool = getPool();
      const client = await pool.connect();
      const token = generateToken();

      try {
        await client.query("begin");
        const userId = await ensureDemoUser(client, email);
        const clientResult = await client.query<{ id: string }>(
          `insert into oauth_client (owner_user_id, name, client_id, allowed_scopes)
           values ($1, $2, $3, $4)
           returning id`,
          [userId, input.name, `ofb_cli_${randomBytes(12).toString("hex")}`, input.scopes],
        );
        const tokenResult = await client.query<ApiTokenRow>(
          `insert into oauth_access_token (user_id, client_id, token_hash, scopes, expires_at)
           values ($1, $2, $3, $4, now() + ($5::int * interval '1 day'))
           returning id, $6::text as name, scopes, expires_at, created_at, revoked_at`,
          [userId, clientResult.rows[0].id, hashToken(token), input.scopes, input.expiresInDays, input.name],
        );

        await client.query("commit");

        return {
          token,
          summary: mapToken(tokenResult.rows[0]),
        };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },
    () => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000);

      return {
        token: generateToken(),
        summary: {
          id: "demo-token",
          name: input.name,
          scopes: input.scopes,
          expiresAt: expiresAt.toISOString(),
          createdAt: now.toISOString(),
          revokedAt: null,
        },
      };
    },
  );
}

export async function revokeApiToken(tokenId: string, email = demoUserEmail) {
  return tryDatabase(
    async () => {
      const result = await query<ApiTokenRow>(
        `update oauth_access_token t
         set revoked_at = now()
         from app_user u
         where t.id = $1
           and t.user_id = u.id
           and u.email = $2
           and t.revoked_at is null
         returning t.id, 'Revoked token'::text as name, t.scopes, t.expires_at, t.created_at, t.revoked_at`,
        [tokenId, email],
      );

      return result.rows[0] ? mapToken(result.rows[0]) : null;
    },
    () => null,
  );
}
