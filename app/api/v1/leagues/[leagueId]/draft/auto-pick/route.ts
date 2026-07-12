import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/data/audit";
import { setAutoPick } from "@/lib/data/draft";
import { draftErrorResponse, guardMutableDraftRoute, resolveDraftViewer, type DraftRouteContext } from "../route-helpers";

const autoPickSchema = z.object({
  enabled: z.boolean(),
});

/**
 * Toggle auto-draft for the viewer's team. Also backs "exit draft" (enable),
 * which lets an absent manager's turns auto-pick. Returns the refreshed state.
 */
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

  const parsed = autoPickSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "An enabled flag is required." }, { status: 400 });
  }

  try {
    const state = await setAutoPick(leagueId, parsed.data.enabled, viewer.userId);
    void recordAuditEvent({
      action: "draft.auto_pick",
      actor: { userId: viewer.userId },
      entityType: "league",
      entityId: leagueId,
      leagueId,
      detail: { enabled: parsed.data.enabled },
      request,
    });
    return NextResponse.json({ draft: state });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
