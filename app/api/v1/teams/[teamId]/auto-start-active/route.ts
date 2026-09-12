import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireTeamManager } from "@/lib/auth/team-access";
import { recordAuditEvent } from "@/lib/data/audit";
import { isDatabaseConfigured, query } from "@/lib/db/client";
import { isRateLimited } from "@/lib/rate-limit";

export async function PATCH(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const auth = await resolveApiIdentity(request, "write:lineup");
  if (auth.response) return auth.response;
  const { teamId } = await params;
  const denied = await requireTeamManager(teamId, auth.identity);
  if (denied) return denied;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Change this setting from the app." }, { status: 403 });
  }
  if (isRateLimited(`auto-start:${auth.identity.userId}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many changes. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false." }, { status: 400 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Auto-start is unavailable in demo mode." }, { status: 503 });
  }
  const result = await query<{ league_id: string; auto_start_active: boolean }>(
    `update fantasy_team set auto_start_active = $2 where id = $1 returning league_id, auto_start_active`,
    [teamId, body.enabled],
  );
  const team = result.rows[0];
  if (!team) return NextResponse.json({ error: "Team not found." }, { status: 404 });
  await recordAuditEvent({
    action: "team.auto_start_active", actor: auth.identity, entityType: "team", entityId: teamId,
    teamId, leagueId: team.league_id, detail: { enabled: team.auto_start_active }, request,
  });
  return NextResponse.json({ enabled: team.auto_start_active });
}
