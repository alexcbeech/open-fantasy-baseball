import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { query, tryDatabase } from "@/lib/db/client";
import type { OAuthScope } from "@/lib/auth/scopes";

export type ApiPrincipal = {
  tokenId: string;
  userId: string;
  email: string;
  scopes: OAuthScope[];
};

type TokenAuthRow = {
  token_id: string;
  user_id: string;
  email: string;
  scopes: OAuthScope[];
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseBearerToken(authorizationHeader: string | null) {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token, extra] = authorizationHeader.trim().split(/\s+/);

  if (extra || scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function verifyBearerToken(token: string) {
  return tryDatabase<ApiPrincipal | null>(
    async () => {
      const result = await query<TokenAuthRow>(
        `select t.id as token_id, t.user_id, u.email, t.scopes
         from oauth_access_token t
         join app_user u on u.id = t.user_id
         where t.token_hash = $1
           and t.revoked_at is null
           and t.expires_at > now()
         limit 1`,
        [hashToken(token)],
      );
      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        tokenId: row.token_id,
        userId: row.user_id,
        email: row.email,
        scopes: row.scopes,
      };
    },
    () => null,
  );
}

export async function authorizeApiRequest(
  request: Request,
  requiredScope: OAuthScope,
  options: { allowMissingBearer?: boolean } = {},
) {
  const header = request.headers.get("authorization");

  if (!header && options.allowMissingBearer) {
    return { principal: null, response: null };
  }

  const token = parseBearerToken(header);

  if (!token) {
    return {
      principal: null,
      response: NextResponse.json({ error: "Bearer token is required." }, { status: 401 }),
    };
  }

  const principal = await verifyBearerToken(token);

  if (!principal) {
    return {
      principal: null,
      response: NextResponse.json({ error: "Bearer token is invalid, expired, or revoked." }, { status: 401 }),
    };
  }

  if (!principal.scopes.includes(requiredScope)) {
    return {
      principal,
      response: NextResponse.json({ error: `Bearer token requires ${requiredScope}.` }, { status: 403 }),
    };
  }

  return { principal, response: null };
}
