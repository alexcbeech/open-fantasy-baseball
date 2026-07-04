import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getLivePlayerStatus } from "@/lib/data/mlb-live";

export const dynamic = "force-dynamic";

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
  const status = await getLivePlayerStatus(playerId);

  return NextResponse.json({ status });
}
