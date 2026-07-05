import { NextResponse } from "next/server";
import { z } from "zod";
import { setupDraft } from "@/lib/data/draft";
import { draftErrorResponse, guardMutableDraftRoute, resolveDraftViewer, type DraftRouteContext } from "../route-helpers";

const setupSchema = z.object({
  pickSeconds: z.coerce.number().int().min(15).max(300),
  randomizeOrder: z.coerce.boolean().default(true),
  order: z.array(z.string().uuid()).optional(),
  fillWithBots: z.coerce.boolean().default(true),
  myTeamName: z.string().trim().min(3).max(40),
});

/** Commissioner-only: create seats (own team + bots) and the draft order. */
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

  const parsed = setupSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid draft setup", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const state = await setupDraft(leagueId, viewer.userId, parsed.data);
    return NextResponse.json({ draft: state }, { status: 201 });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
