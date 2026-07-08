import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireLeagueViewer } from "@/lib/auth/team-access";
import { getLeagueOverview } from "@/lib/data/leagues";

type RouteContext = {
  params: Promise<{
    leagueId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "read:league");

  if (auth.response) {
    return auth.response;
  }

  const { leagueId } = await params;
  const accessDenied = await requireLeagueViewer(leagueId, auth.identity);

  if (accessDenied) {
    return accessDenied;
  }

  const overview = await getLeagueOverview(leagueId);

  return NextResponse.json({ overview });
}
