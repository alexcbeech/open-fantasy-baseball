import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireLeagueViewer } from "@/lib/auth/team-access";
import { readRoute } from "@/lib/api/read-route";
import { listTradesForLeague, proposeTrade, TradeError } from "@/lib/data/trades";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";

type RouteContext = {
  params: Promise<{
    leagueId: string;
  }>;
};

const proposeSchema = z.object({
  fromTeamId: z.string().uuid(),
  toTeamId: z.string().uuid(),
  offeredPlayerIds: z.array(z.string().uuid()).min(1).max(10),
  requestedPlayerIds: z.array(z.string().uuid()).min(1).max(10),
  fromDropPlayerIds: z.array(z.string().uuid()).max(10).optional(),
});

export async function GET(request: Request, { params }: RouteContext) {
  return readRoute(async () => {
    const auth = await resolveApiIdentity(request, "read:league");

    if (auth.response) {
      return auth.response;
    }

    const { leagueId } = await params;

    if (!isDatabaseConfigured() || !isUuid(leagueId)) {
      return NextResponse.json({ trades: [] });
    }

    const accessDenied = await requireLeagueViewer(leagueId, auth.identity);

    if (accessDenied) {
      return accessDenied;
    }

    return NextResponse.json({ trades: await listTradesForLeague(leagueId, auth.identity) });
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "write:trades");

  if (auth.response) {
    return auth.response;
  }

  const { leagueId } = await params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Trades require a configured database." }, { status: 503 });
  }

  if (!isUuid(leagueId)) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const parsed = proposeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid trade offer." }, { status: 400 });
  }

  try {
    const trade = await proposeTrade(leagueId, parsed.data, auth.identity);
    return NextResponse.json({ trade }, { status: 201 });
  } catch (error) {
    if (error instanceof TradeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
