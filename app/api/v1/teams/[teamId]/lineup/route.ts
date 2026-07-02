import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getLineupForTeam, getTeamSummary } from "@/lib/data/teams";
import { validateLineup } from "@/lib/fantasy/roster-validation";
import type { LineupPlayer, RosterSlot } from "@/lib/fantasy/types";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

const rosterSlots: RosterSlot[] = ["C", "1B", "2B", "3B", "SS", "OF", "UTIL", "SP", "RP", "P", "BN", "IL", "NA"];

function findTeam(teamId: string) {
  return getTeamSummary(teamId);
}

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(_request, "read:team", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { teamId } = await params;

  if (!(await findTeam(teamId))) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const lineup = await getLineupForTeam(teamId);

  return NextResponse.json({
    lineup,
    validation: validateLineup(lineup),
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(request, "write:lineup", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { teamId } = await params;

  if (!(await findTeam(teamId))) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    entries?: Array<{
      playerId: string;
      slot: RosterSlot;
    }>;
  };

  if (!body.entries?.length) {
    return NextResponse.json({ error: "Lineup entries are required" }, { status: 400 });
  }

  const proposedLineup: LineupPlayer[] = [];
  const currentLineup = await getLineupForTeam(teamId);

  for (const entry of body.entries) {
    const currentEntry = currentLineup.find((candidate) => candidate.player.id === entry.playerId);

    if (!currentEntry || !rosterSlots.includes(entry.slot)) {
      return NextResponse.json({ error: "Invalid player or slot" }, { status: 400 });
    }

    proposedLineup.push({
      slot: entry.slot,
      player: currentEntry.player,
      matchupTotal: currentEntry.matchupTotal,
    });
  }

  const validation = validateLineup(proposedLineup);

  return NextResponse.json(
    {
      accepted: validation.valid,
      lineup: proposedLineup,
      validation,
      next: validation.valid ? "Persist lineup once database access is wired." : "Fix lineup validation issues.",
    },
    { status: validation.valid ? 202 : 200 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeApiRequest(request, "write:lineup", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const formData = await request.formData();
  const entries = Array.from(formData.entries())
    .filter(([key]) => key.startsWith("slot:"))
    .map(([key, value]) => ({
      playerId: key.replace("slot:", ""),
      slot: value.toString() as RosterSlot,
    }));

  return PATCH(
    new Request(request.url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(request.headers.get("authorization") ? { authorization: request.headers.get("authorization") ?? "" } : {}),
      },
      body: JSON.stringify({ entries }),
    }),
    context,
  );
}
