import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAuditEvent } from "@/lib/data/audit";
import { pauseDraft } from "@/lib/data/draft";
import { draftErrorResponse, guardMutableDraftRoute, resolveDraftViewer, type DraftRouteContext } from "../route-helpers";

const pauseSchema = z.object({
  action: z.enum(["pause", "resume"]),
});

/** Commissioner-only: pause preserves the clock remainder; resume restores it. */
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

  const parsed = pauseSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "Action must be pause or resume." }, { status: 400 });
  }

  try {
    const state = await pauseDraft(leagueId, viewer.userId, parsed.data.action);
    void recordAuditEvent({
      action: `draft.${parsed.data.action}`,
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
