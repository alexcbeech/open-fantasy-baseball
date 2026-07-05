import { NextResponse } from "next/server";
import { startDraft } from "@/lib/data/draft";
import { draftErrorResponse, guardMutableDraftRoute, resolveDraftViewer, type DraftRouteContext } from "../route-helpers";

/** Commissioner-only: start the clock on pick 1 and mark the league drafting. */
export async function POST(request: Request, { params }: DraftRouteContext) {
  const viewer = await resolveDraftViewer(request, "write:draft");

  if (viewer.response) {
    return viewer.response;
  }

  const { leagueId } = await params;
  const guard = guardMutableDraftRoute(leagueId);

  if (guard) {
    return guard;
  }

  try {
    const state = await startDraft(leagueId, viewer.userId);
    return NextResponse.json({ draft: state });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
