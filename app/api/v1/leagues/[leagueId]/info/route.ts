import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { isLeagueCommissioner } from "@/lib/auth/team-access";
import { recordAuditEvent } from "@/lib/data/audit";
import { LeagueHubError, updateLeagueTradeDeadline } from "@/lib/data/league-hub";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";

type RouteContext = { params: Promise<{ leagueId: string }> };

const updateSchema = z.object({ tradeDeadlineAt: z.iso.datetime().nullable() }).strict();

/** Commissioner-only league calendar metadata that is not a scoring setting. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "commissioner:league");

  if (auth.response) {
    return auth.response;
  }

  const { leagueId } = await params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "League information requires a configured database." }, { status: 503 });
  }

  if (!isUuid(leagueId)) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  if (!(await isLeagueCommissioner(leagueId, auth.identity))) {
    return NextResponse.json({ error: "Only the commissioner can change league information." }, { status: 403 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid trade deadline." }, { status: 400 });
  }

  try {
    const tradeDeadlineAt = await updateLeagueTradeDeadline(
      leagueId,
      parsed.data.tradeDeadlineAt ? new Date(parsed.data.tradeDeadlineAt) : null,
    );
    void recordAuditEvent({
      action: "league.info_update",
      actor: auth.identity,
      entityType: "league",
      entityId: leagueId,
      leagueId,
      detail: { tradeDeadlineAt },
      request,
    });
    return NextResponse.json({ leagueId, tradeDeadlineAt });
  } catch (error) {
    if (error instanceof LeagueHubError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
