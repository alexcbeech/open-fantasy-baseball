import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { computeLiveMatchup } from "@/lib/data/live-matchup";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(request, "read:league", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { teamId } = await params;
  const update = await computeLiveMatchup(teamId);

  return NextResponse.json({ update });
}
