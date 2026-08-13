import { NextResponse } from "next/server";
import { z } from "zod";
import { dequeueDraftPlayer, enqueueDraftPlayer, reorderDraftQueue } from "@/lib/data/draft";
import { draftErrorResponse, guardMutableDraftRoute, resolveDraftViewer, type DraftRouteContext } from "../route-helpers";

const queueSchema = z.object({
  playerId: z.string().uuid(),
});

const reorderSchema = z.object({
  playerIds: z.array(z.string().uuid()).max(500),
});

/** Add a player to the viewer's draft queue. Returns the refreshed DraftState. */
export async function POST(request: Request, { params }: DraftRouteContext) {
  return mutateQueue(request, params, enqueueDraftPlayer);
}

/** Remove a player from the viewer's draft queue. */
export async function DELETE(request: Request, { params }: DraftRouteContext) {
  return mutateQueue(request, params, dequeueDraftPlayer);
}

/** Persist the viewer's complete queue order. */
export async function PATCH(request: Request, { params }: DraftRouteContext) {
  const viewer = await resolveDraftViewer(request, "write:draft");

  if (viewer.response) {
    return viewer.response;
  }

  const { leagueId } = await params;
  const guard = guardMutableDraftRoute(leagueId);

  if (guard) {
    return guard;
  }

  const parsed = reorderSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "A valid queue order is required." }, { status: 400 });
  }

  try {
    const state = await reorderDraftQueue(leagueId, parsed.data.playerIds, viewer.userId);
    return NextResponse.json({ draft: state });
  } catch (error) {
    return draftErrorResponse(error);
  }
}

async function mutateQueue(
  request: Request,
  params: DraftRouteContext["params"],
  action: (leagueId: string, playerId: string, viewerUserId: string) => Promise<unknown>,
) {
  const viewer = await resolveDraftViewer(request, "write:draft");

  if (viewer.response) {
    return viewer.response;
  }

  const { leagueId } = await params;
  const guard = guardMutableDraftRoute(leagueId);

  if (guard) {
    return guard;
  }

  const parsed = queueSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: "A player id is required." }, { status: 400 });
  }

  try {
    const state = await action(leagueId, parsed.data.playerId, viewer.userId);
    return NextResponse.json({ draft: state });
  } catch (error) {
    return draftErrorResponse(error);
  }
}
