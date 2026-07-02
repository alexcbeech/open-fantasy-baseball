import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getPlayerDetail } from "@/lib/data/players";

type RouteContext = {
  params: Promise<{
    playerId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(request, "read:league", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { playerId } = await params;
  const player = await getPlayerDetail(playerId);

  if (!player) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  return NextResponse.json({ player });
}
