import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { apiTokenCreateSchema, createApiToken, listApiTokens } from "@/lib/data/api-tokens";

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
  const auth = await authorizeApiRequest(request, "read:profile", { allowMissingBearer: true });

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

  const currentUser = auth.principal ?? (await getCurrentOfbUser());

  if (!currentUser) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  const createdToken = await createApiToken(parsed.data, currentUser.email);

  return NextResponse.json(createdToken, { status: 201 });
}
