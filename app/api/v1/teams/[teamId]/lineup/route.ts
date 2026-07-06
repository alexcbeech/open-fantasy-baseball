import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getLineupForTeam, getTeamSummary, LineupSaveError, saveLineupSlots } from "@/lib/data/teams";
import { isDatabaseConfigured } from "@/lib/db/client";
import { findLineupLockIssues, validateLineup } from "@/lib/fantasy/roster-validation";
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

  let body: {
    entries?: Array<{
      playerId: string;
      slot: RosterSlot;
    }>;
  };

  try {
    body = await request.json();
  } catch {
    // Covers malformed JSON and requests aborted mid-body (e.g. navigation).
    return NextResponse.json({ error: "A JSON body with lineup entries is required" }, { status: 400 });
  }

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
  // A player whose MLB game has started is locked in place until the next
  // daily rollover; the API enforces this so it can't be bypassed client-side.
  const lockIssues = findLineupLockIssues(currentLineup, proposedLineup);

  if (!validation.valid || lockIssues.length) {
    return NextResponse.json(
      {
        accepted: false,
        lineup: proposedLineup,
        validation: {
          ...validation,
          valid: false,
          issues: [...lockIssues, ...validation.issues],
        },
        next: "Fix lineup validation issues.",
      },
      { status: lockIssues.length ? 409 : 200 },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        accepted: true,
        lineup: proposedLineup,
        validation,
        next: "Demo mode: lineup validated but not persisted (no database configured).",
      },
      { status: 202 },
    );
  }

  try {
    await saveLineupSlots(
      teamId,
      body.entries.map((entry) => ({ playerId: entry.playerId, slot: entry.slot })),
    );
  } catch (error) {
    if (error instanceof LineupSaveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }

  return NextResponse.json(
    {
      accepted: true,
      lineup: proposedLineup,
      validation,
      next: "Lineup saved.",
    },
    { status: 200 },
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
      body: JSON.stringify(entries.length ? { entries } : {}),
    }),
    context,
  );
}
