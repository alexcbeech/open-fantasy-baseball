import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import type { OAuthScope } from "@/lib/auth/scopes";

export type ApiIdentity = {
  userId: string;
  email: string;
};

/**
 * Resolves who is calling an API route: a bearer-token principal when one is
 * presented (scope-checked), otherwise the signed-in session user. Returns an
 * error response when neither identity is available, so per-user resources are
 * never served anonymously.
 */
export async function resolveApiIdentity(
  request: Request,
  scope: OAuthScope,
): Promise<{ identity: ApiIdentity; response: null } | { identity: null; response: NextResponse }> {
  const auth = await authorizeApiRequest(request, scope, { allowMissingBearer: true });

  if (auth.response) {
    return { identity: null, response: auth.response };
  }

  if (auth.principal) {
    return { identity: { userId: auth.principal.userId, email: auth.principal.email }, response: null };
  }

  const user = await getCurrentOfbUser();

  if (!user) {
    return { identity: null, response: NextResponse.json({ error: "Sign in is required." }, { status: 401 }) };
  }

  return { identity: { userId: user.userId, email: user.email }, response: null };
}
