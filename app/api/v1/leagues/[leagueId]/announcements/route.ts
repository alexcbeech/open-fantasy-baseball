import { NextResponse } from "next/server";
import { z } from "zod";
import { readRoute } from "@/lib/api/read-route";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { isLeagueCommissioner, requireLeagueViewer } from "@/lib/auth/team-access";
import { recordAuditEvent } from "@/lib/data/audit";
import { createLeagueAnnouncement, getLeagueHubDetails, LeagueHubError } from "@/lib/data/league-hub";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";

type RouteContext = { params: Promise<{ leagueId: string }> };

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
    isPinned: z.boolean().default(false),
  })
  .strict();

export async function GET(request: Request, { params }: RouteContext) {
  return readRoute(async () => {
    const auth = await resolveApiIdentity(request, "read:league");

    if (auth.response) {
      return auth.response;
    }

    const { leagueId } = await params;

    if (!isDatabaseConfigured() || !isUuid(leagueId)) {
      return NextResponse.json({ announcements: [] });
    }

    const accessDenied = await requireLeagueViewer(leagueId, auth.identity);

    if (accessDenied) {
      return accessDenied;
    }

    const { announcements } = await getLeagueHubDetails(leagueId);
    return NextResponse.json({ announcements });
  });
}

export async function POST(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "commissioner:league");

  if (auth.response) {
    return auth.response;
  }

  const { leagueId } = await params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "League announcements require a configured database." }, { status: 503 });
  }

  if (!isUuid(leagueId)) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  if (!(await isLeagueCommissioner(leagueId, auth.identity))) {
    return NextResponse.json({ error: "Only the commissioner can publish league announcements." }, { status: 403 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an announcement title and message." }, { status: 400 });
  }

  try {
    const announcement = await createLeagueAnnouncement(leagueId, parsed.data, auth.identity);
    void recordAuditEvent({
      action: "league.announcement_create",
      actor: auth.identity,
      entityType: "league_announcement",
      entityId: announcement.id,
      leagueId,
      detail: { title: announcement.title, isPinned: announcement.isPinned },
      request,
    });
    return NextResponse.json({ announcement }, { status: 201 });
  } catch (error) {
    if (error instanceof LeagueHubError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
