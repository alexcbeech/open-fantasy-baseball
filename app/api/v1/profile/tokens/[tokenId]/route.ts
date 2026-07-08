import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getCurrentOfbUser } from "@/lib/auth/neon-auth";
import { revokeApiToken } from "@/lib/data/api-tokens";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    tokenId: string;
  }>;
};

export async function DELETE(_request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(_request, "write:profile", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { tokenId } = await params;
  const currentUser = auth.principal ?? (await getCurrentOfbUser());

  if (!currentUser) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  const revokedToken = await revokeApiToken(tokenId, currentUser.email);

  if (!revokedToken) {
    return NextResponse.json({ error: "API token not found." }, { status: 404 });
  }

  return NextResponse.json({ token: revokedToken });
}
