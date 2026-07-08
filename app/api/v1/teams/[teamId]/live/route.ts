import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireTeamViewer } from "@/lib/auth/team-access";
import { getLiveLineupStatus } from "@/lib/data/mlb-live";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "read:league");

  if (auth.response) {
    return auth.response;
  }

  const { teamId } = await params;
  const accessDenied = await requireTeamViewer(teamId, auth.identity);

  if (accessDenied) {
    return accessDenied;
  }

  const live = await getLiveLineupStatus(teamId);

  return NextResponse.json({ live });
}
