import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireTeamViewer } from "@/lib/auth/team-access";
import { readRoute } from "@/lib/api/read-route";
import { getMatchupDetailsForTeam } from "@/lib/data/matchups";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  return readRoute(async () => {
    const auth = await resolveApiIdentity(request, "read:team");

    if (auth.response) {
      return auth.response;
    }

    const { teamId } = await params;
    const accessDenied = await requireTeamViewer(teamId, auth.identity);

    if (accessDenied) {
      return accessDenied;
    }

    const matchup = await getMatchupDetailsForTeam(teamId);

    if (!matchup) {
      return NextResponse.json({ error: "Matchup not found" }, { status: 404 });
    }

    return NextResponse.json({ matchup });
  });
}
