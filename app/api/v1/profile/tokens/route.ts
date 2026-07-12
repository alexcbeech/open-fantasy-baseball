import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { apiTokenCreateSchema, createApiToken, listApiTokens } from "@/lib/data/api-tokens";
import { recordAuditEvent } from "@/lib/data/audit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApiRequest(request, "read:profile", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const currentUser = auth.principal ?? (await getCurrentOfbUser());

  if (!currentUser) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  const tokens = await listApiTokens(currentUser.email);

  return NextResponse.json({ tokens });
}

export async function POST(request: Request) {
  const auth = await authorizeApiRequest(request, "write:profile", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const body = await request.json();
  const parsed = apiTokenCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "API token settings are invalid.",
        issues: parsed.error.issues.map((issue) => issue.message),
      },
      { status: 400 },
    );
  }

  // A bearer token may only mint tokens with scopes it already holds;
  // otherwise a leaked read-only token could self-escalate to full access.
  // Session-authenticated users (no bearer) act with their full account.
  const requestingPrincipal = auth.principal;

  if (requestingPrincipal) {
    const escalated = parsed.data.scopes.filter((scope) => !requestingPrincipal.scopes.includes(scope));

    if (escalated.length) {
      return NextResponse.json(
        { error: `The requesting token does not hold: ${escalated.join(", ")}.` },
        { status: 403 },
      );
    }
  }

  const currentUser = auth.principal ?? (await getCurrentOfbUser());

  if (!currentUser) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  const createdToken = await createApiToken(parsed.data, currentUser.email);

  // Token creation is a security-sensitive event; the token itself never
  // appears in the audit row.
  void recordAuditEvent({
    action: "token.create",
    actor: { userId: currentUser.userId, email: currentUser.email },
    detail: { name: parsed.data.name, scopes: parsed.data.scopes, expiresInDays: parsed.data.expiresInDays },
    request,
  });

  return NextResponse.json(createdToken, { status: 201 });
}
