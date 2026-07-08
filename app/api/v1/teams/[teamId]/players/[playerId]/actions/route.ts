import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireTeamManager } from "@/lib/auth/team-access";
import {
  applyPlayerManagementAction,
  PlayerActionError,
  type PlayerManagementAction,
} from "@/lib/data/player-actions";
import { isDatabaseConfigured } from "@/lib/db/client";

type RouteContext = {
  params: Promise<{
    teamId: string;
    playerId: string;
  }>;
};

const actions: PlayerManagementAction[] = ["add", "drop", "move-to-il", "move-to-na"];

export async function POST(request: Request, { params }: RouteContext) {
  const body = (await request.json()) as { action?: string };

  if (!body.action || !actions.includes(body.action as PlayerManagementAction)) {
    return NextResponse.json({ error: "A valid player action is required." }, { status: 400 });
  }

  const action = body.action as PlayerManagementAction;
  const requiredScope = action === "add" || action === "drop" ? "write:transactions" : "write:lineup";
  const auth = await resolveApiIdentity(request, requiredScope);

  if (auth.response) {
    return auth.response;
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Player actions require a configured database." }, { status: 503 });
  }

  const { teamId, playerId } = await params;
  const accessDenied = await requireTeamManager(teamId, auth.identity);

  if (accessDenied) {
    return accessDenied;
  }

  try {
    const player = await applyPlayerManagementAction(teamId, playerId, action);
    return NextResponse.json({
      accepted: true,
      action,
      player,
    });
  } catch (error) {
    if (error instanceof PlayerActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
