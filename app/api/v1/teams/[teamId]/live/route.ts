import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getLiveLineupStatus } from "@/lib/data/mlb-live";

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
  const live = await getLiveLineupStatus(teamId);

  return NextResponse.json({ live });
}
