import { isLineupDate, lineupToday } from "@/lib/fantasy/lineup-date";
import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireTeamViewer } from "@/lib/auth/team-access";
import { readRoute } from "@/lib/api/read-route";
import { getLineupDayStatus, getTeamDailyPlayerStatus } from "@/lib/data/mlb-live";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  return readRoute(async () => {
    const auth = await resolveApiIdentity(request, "read:league");

    if (auth.response) {
      return auth.response;
    }

    const { teamId } = await params;
    const accessDenied = await requireTeamViewer(teamId, auth.identity);

    if (accessDenied) {
      return accessDenied;
    }

    const date = new URL(request.url).searchParams.get("date");
    if (date !== null && !isLineupDate(date)) return NextResponse.json({ error: "Invalid lineup date" }, { status: 400 });
    const today = lineupToday();
    const status = date && date !== today
      ? date > today ? { live: {}, today: {}, lineups: {} }
        : { ...await getLineupDayStatus(teamId, undefined, new Date(`${date}T16:00:00Z`)), live: {}, lineups: {} }
      : await getTeamDailyPlayerStatus(teamId);

    return NextResponse.json(status);
  });
}
