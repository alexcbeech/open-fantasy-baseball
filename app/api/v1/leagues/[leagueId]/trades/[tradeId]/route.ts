import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { recordAuditEvent } from "@/lib/data/audit";
import { respondToTrade, TradeError, vetoTrade, voteAgainstTrade, withdrawTrade } from "@/lib/data/trades";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";

type RouteContext = {
  params: Promise<{
    leagueId: string;
    tradeId: string;
  }>;
};

const actionSchema = z.object({
  action: z.enum(["accept", "decline", "withdraw", "vote", "veto"]),
  dropPlayerIds: z.array(z.string().uuid()).max(10).optional(),
});

/**
 * All trade lifecycle actions share one endpoint; the data layer enforces who
 * may do what (recipient responds, proposer withdraws, outside teams vote,
 * commissioner vetoes).
 */
export async function POST(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "write:trades");

  if (auth.response) {
    return auth.response;
  }

  const { leagueId, tradeId } = await params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Trades require a configured database." }, { status: 503 });
  }

  if (!isUuid(leagueId) || !isUuid(tradeId)) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body with an action is required." }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid trade action." }, { status: 400 });
  }

  try {
    const { action, dropPlayerIds } = parsed.data;
    const trade =
      action === "accept" || action === "decline"
        ? await respondToTrade(leagueId, tradeId, { action, toDropPlayerIds: dropPlayerIds }, auth.identity)
        : action === "withdraw"
          ? await withdrawTrade(leagueId, tradeId, auth.identity)
          : action === "vote"
            ? await voteAgainstTrade(leagueId, tradeId, auth.identity)
            : await vetoTrade(leagueId, tradeId, auth.identity);

    void recordAuditEvent({
      action: `trade.${action}`,
      actor: auth.identity,
      entityType: "trade",
      entityId: tradeId,
      leagueId,
      detail: dropPlayerIds?.length ? { dropPlayerIds } : {},
      request,
    });

    return NextResponse.json({ trade });
  } catch (error) {
    if (error instanceof TradeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
