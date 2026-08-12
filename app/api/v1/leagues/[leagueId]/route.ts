import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { recordAuditEvent } from "@/lib/data/audit";
import { deleteLeague, LeagueDeletionError } from "@/lib/data/leagues";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";

type RouteContext = {
  params: Promise<{
    leagueId: string;
  }>;
};

/** Creator-only: permanently delete a league and its dependent records. */
export async function DELETE(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "commissioner:league");

  if (auth.response) {
    return auth.response;
  }

  const { leagueId } = await params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "League deletion requires a configured database." }, { status: 503 });
  }

  if (!isUuid(leagueId)) {
    return NextResponse.json({ error: "League not found." }, { status: 404 });
  }

  try {
    const deleted = await deleteLeague(leagueId, auth.identity);

    void recordAuditEvent({
      action: "league.delete",
      actor: auth.identity,
      entityType: "league",
      entityId: leagueId,
      leagueId,
      detail: { name: deleted.name },
      request,
    });

    return NextResponse.json({ deleted: true, leagueId });
  } catch (error) {
    if (error instanceof LeagueDeletionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
