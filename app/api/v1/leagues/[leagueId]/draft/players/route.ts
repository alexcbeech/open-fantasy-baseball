import { NextResponse } from "next/server";
import { listDraftPlayers } from "@/lib/data/draft";
import type { RosterSlot } from "@/lib/fantasy/types";
import { draftErrorResponse, resolveDraftViewer, type DraftRouteContext } from "../route-helpers";

const positions: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "UTIL", "SP", "RP", "P"];

/** Undrafted, pool-filtered players ranked by ADP for the draft board. */
export async function GET(request: Request, { params }: DraftRouteContext) {
  const viewer = await resolveDraftViewer(request, "read:team");

  if (viewer.response) {
    return viewer.response;
  }

  const { leagueId } = await params;
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? undefined;
  const positionParam = url.searchParams.get("position");
  const position = positions.find((candidate) => candidate === positionParam);

  try {
    const players = await listDraftPlayers(leagueId, { query, position });
    return NextResponse.json({ players });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
