import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { readRoute } from "@/lib/api/read-route";
import { listPlayers } from "@/lib/data/players";
import type { Player } from "@/lib/fantasy/types";

export async function GET(request: Request) {
  return readRoute(async () => {
    const auth = await authorizeApiRequest(request, "read:league", { allowMissingBearer: true });

    if (auth.response) {
      return auth.response;
    }

    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? undefined;
    const availability = (url.searchParams.get("availability") as Player["availability"] | null) ?? undefined;
    const players = await listPlayers({ query, availability });

    return NextResponse.json({
      players,
      statWindows: ["season", "last-7", "last-14", "last-30", "projected-rest-of-season"],
    });
  });
}
