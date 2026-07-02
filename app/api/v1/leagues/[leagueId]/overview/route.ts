import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getLeagueOverview } from "@/lib/data/leagues";

type RouteContext = {
  params: Promise<{
    leagueId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(request, "read:league", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { leagueId } = await params;
  const overview = await getLeagueOverview(leagueId);

  return NextResponse.json({ overview });
}
