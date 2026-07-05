import { NextResponse } from "next/server";
import { getDraftState } from "@/lib/data/draft";
import { draftErrorResponse, resolveDraftViewer, type DraftRouteContext } from "./route-helpers";

/**
 * Draft-room poll target. Reading the state also advances any expired turns
 * (lazy clock), so bots and auto-picks resolve as long as anyone is watching.
 */
export async function GET(request: Request, { params }: DraftRouteContext) {
  const viewer = await resolveDraftViewer(request, "read:team");

  if (viewer.response) {
    return viewer.response;
  }

  const { leagueId } = await params;

  try {
    const state = await getDraftState(leagueId, viewer.userId);

    if (!state) {
      return NextResponse.json({ error: "Draft has not been set up." }, { status: 404 });
    }

    return NextResponse.json({ draft: state });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
