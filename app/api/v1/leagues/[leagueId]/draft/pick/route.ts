import { NextResponse } from "next/server";
import { z } from "zod";
import { makePick } from "@/lib/data/draft";
import { draftErrorResponse, guardMutableDraftRoute, resolveDraftViewer, type DraftRouteContext } from "../route-helpers";

const pickSchema = z.object({
  playerId: z.string().uuid(),
});

/**
 * Make the on-clock pick. The response is the full refreshed DraftState so
 * the client swaps state wholesale instead of reconciling deltas.
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

  const parsed = pickSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "A player id is required." }, { status: 400 });
  }

  try {
    const state = await makePick(leagueId, parsed.data.playerId, viewer.userId);
    return NextResponse.json({ draft: state });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
