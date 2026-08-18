import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireTeamManager } from "@/lib/auth/team-access";
import { recordAuditEvent } from "@/lib/data/audit";
import { TeamNameUpdateError, updateTeamName } from "@/lib/data/teams";
import { isDatabaseConfigured } from "@/lib/db/client";

type RouteContext = {
  params: Promise<{ teamId: string }>;
};

const teamUpdateSchema = z.object({
  name: z.string().trim().min(3, "Team name must be at least 3 characters.").max(40, "Team name must be 40 characters or less."),
});

export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "write:team");

  if (auth.response) {
    return auth.response;
  }

  const { teamId } = await params;
  const accessDenied = await requireTeamManager(teamId, auth.identity);

  if (accessDenied) {
    return accessDenied;
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Team renaming requires a configured database." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const parsed = teamUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Team name is invalid.", issues: parsed.error.issues.map((issue) => issue.message) },
      { status: 400 },
    );
  }

  try {
    const name = await updateTeamName(teamId, parsed.data.name);

    void recordAuditEvent({
      action: "team.rename",
      actor: auth.identity,
      entityType: "team",
      entityId: teamId,
      teamId,
      detail: { name },
      request,
    });

    return NextResponse.json({ team: { id: teamId, name } });
  } catch (error) {
    if (error instanceof TeamNameUpdateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
