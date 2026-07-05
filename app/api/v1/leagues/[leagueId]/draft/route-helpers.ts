import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { DraftError } from "@/lib/draft/types";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";
import type { OAuthScope } from "@/lib/auth/scopes";

export type DraftRouteContext = {
  params: Promise<{ leagueId: string }>;
};

/**
 * Resolves who is acting: a bearer-token principal when one is presented
 * (scope-checked), otherwise the signed-in session user. Returns an error
 * response when neither identity is available.
 */
export async function resolveDraftViewer(
  request: Request,
  scope: OAuthScope,
): Promise<{ userId: string; response: null } | { userId: null; response: NextResponse }> {
  const auth = await authorizeApiRequest(request, scope, { allowMissingBearer: true });

  if (auth.response) {
    return { userId: null, response: auth.response };
  }

  if (auth.principal) {
    return { userId: auth.principal.userId, response: null };
  }

  const user = await getCurrentOfbUser();

  if (!user) {
    return { userId: null, response: NextResponse.json({ error: "Sign in to use the draft." }, { status: 401 }) };
  }

  return { userId: user.userId, response: null };
}

/** Common guards for mutating draft routes: real DB + UUID league id. */
export function guardMutableDraftRoute(leagueId: string): NextResponse | null {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Drafting requires a configured database." }, { status: 503 });
  }

  if (!isUuid(leagueId)) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  return null;
}

export function draftErrorResponse(error: unknown): NextResponse {
  if (error instanceof DraftError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  throw error;
}
