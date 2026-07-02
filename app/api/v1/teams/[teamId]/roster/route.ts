import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getLineupForTeam, getTeamSummary } from "@/lib/data/teams";
import { validateLineup } from "@/lib/fantasy/roster-validation";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(_request, "read:team", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { teamId } = await params;
  const team = await getTeamSummary(teamId);

  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const lineup = await getLineupForTeam(teamId);

  return NextResponse.json({
    team,
    roster: lineup,
    validation: validateLineup(lineup),
    lineupLocks: {
      mode: "daily",
      nextLockAt: null,
    },
  });
}
