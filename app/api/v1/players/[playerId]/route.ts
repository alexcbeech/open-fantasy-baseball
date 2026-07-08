import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { readRoute } from "@/lib/api/read-route";
import { getPlayerDetail } from "@/lib/data/players";

type RouteContext = {
  params: Promise<{
    playerId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  return readRoute(async () => {
    const auth = await authorizeApiRequest(request, "read:league", { allowMissingBearer: true });

    if (auth.response) {
      return auth.response;
    }

    const { playerId } = await params;
    // Optional team context so the response's management flags (drop/IL/NA) are
    // scoped to that team's roster rather than the whole league.
    const teamId = new URL(request.url).searchParams.get("teamId") ?? undefined;
    const player = await getPlayerDetail(playerId, teamId);

    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }

    return NextResponse.json({ player });
  });
}
