import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getMatchupDetailsForTeam } from "@/lib/data/matchups";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(request, "read:team", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { teamId } = await params;
  const matchup = await getMatchupDetailsForTeam(teamId);

  if (!matchup) {
    return NextResponse.json({ error: "Matchup not found" }, { status: 404 });
  }

  return NextResponse.json({ matchup });
}
