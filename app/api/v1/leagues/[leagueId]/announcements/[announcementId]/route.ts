import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { isLeagueCommissioner } from "@/lib/auth/team-access";
import { recordAuditEvent } from "@/lib/data/audit";
import { archiveLeagueAnnouncement, LeagueHubError, setLeagueAnnouncementPinned } from "@/lib/data/league-hub";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";

type RouteContext = { params: Promise<{ leagueId: string; announcementId: string }> };
const updateSchema = z.object({ isPinned: z.boolean() }).strict();

async function authorize(request: Request, context: RouteContext) {
  const auth = await resolveApiIdentity(request, "commissioner:league");

  if (auth.response) {
    return { response: auth.response } as const;
  }

  const { leagueId, announcementId } = await context.params;

  if (!isDatabaseConfigured()) {
    return {
      response: NextResponse.json({ error: "League announcements require a configured database." }, { status: 503 }),
    } as const;
  }

  if (!isUuid(leagueId) || !isUuid(announcementId)) {
    return { response: NextResponse.json({ error: "Announcement not found" }, { status: 404 }) } as const;
  }

  if (!(await isLeagueCommissioner(leagueId, auth.identity))) {
    return {
      response: NextResponse.json({ error: "Only the commissioner can manage league announcements." }, { status: 403 }),
    } as const;
  }

  return { auth, leagueId, announcementId } as const;
}

export async function PATCH(request: Request, context: RouteContext) {
  const access = await authorize(request, context);

  if ("response" in access) {
    return access.response;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid announcement update." }, { status: 400 });
  }

  try {
    const announcement = await setLeagueAnnouncementPinned(
      access.leagueId,
      access.announcementId,
      parsed.data.isPinned,
    );
    void recordAuditEvent({
      action: "league.announcement_update",
      actor: access.auth.identity,
      entityType: "league_announcement",
      entityId: access.announcementId,
      leagueId: access.leagueId,
      detail: parsed.data,
      request,
    });
    return NextResponse.json({ announcement });
  } catch (error) {
    if (error instanceof LeagueHubError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const access = await authorize(request, context);

  if ("response" in access) {
    return access.response;
  }

  try {
    await archiveLeagueAnnouncement(access.leagueId, access.announcementId);
    void recordAuditEvent({
      action: "league.announcement_archive",
      actor: access.auth.identity,
      entityType: "league_announcement",
      entityId: access.announcementId,
      leagueId: access.leagueId,
      request,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof LeagueHubError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
