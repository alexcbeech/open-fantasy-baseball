import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/data/audit";
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
    void recordAuditEvent({
      action: "draft.start",
      actor: { userId: viewer.userId },
      entityType: "league",
      entityId: leagueId,
      leagueId,
      request,
    });
    return NextResponse.json({ draft: state });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
