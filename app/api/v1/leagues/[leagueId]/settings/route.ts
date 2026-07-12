import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { isLeagueCommissioner, requireLeagueViewer } from "@/lib/auth/team-access";
import { readRoute } from "@/lib/api/read-route";
import { recordAuditEvent } from "@/lib/data/audit";
import { getLeagueSettings, updateLeagueSettings } from "@/lib/data/leagues";
import { commissionerEditableSettings } from "@/lib/fantasy/defaults";
import { getSettingsForScoringType, lineupLockModes, tradeReviewModes, waiverModes } from "@/lib/fantasy/settings-matrix";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";

type RouteContext = {
  params: Promise<{
    leagueId: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  return readRoute(async () => {
    const auth = await resolveApiIdentity(_request, "read:league");

    if (auth.response) {
      return auth.response;
    }

    const { leagueId } = await params;
    const accessDenied = await requireLeagueViewer(leagueId, auth.identity);

    if (accessDenied) {
      return accessDenied;
    }

    const settings = await getLeagueSettings(leagueId);

    return NextResponse.json({
      leagueId,
      settings,
      editableSettings: commissionerEditableSettings,
      settingDefinitions: getSettingsForScoringType(settings.scoringType),
    });
  });
}

const updateSchema = z
  .object({
    waiverMode: z.enum([waiverModes[0], waiverModes[1]]).optional(),
    faabBudget: z.coerce.number().int().min(0).max(1000).optional(),
    tradeReview: z.enum([tradeReviewModes[0], tradeReviewModes[1], tradeReviewModes[2]]).optional(),
    tradeReviewDays: z.coerce.number().int().min(0).max(7).optional(),
    lineupLockMode: z.enum([lineupLockModes[0], lineupLockModes[1]]).optional(),
    waiverProcessingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    allowILPlus: z.boolean().optional(),
    allowNA: z.boolean().optional(),
  })
  .strict();

/** Commissioner-only: update the post-creation-editable league settings. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const auth = await resolveApiIdentity(request, "commissioner:league");

  if (auth.response) {
    return auth.response;
  }

  const { leagueId } = await params;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "League settings require a configured database." }, { status: 503 });
  }

  if (!isUuid(leagueId)) {
    return NextResponse.json({ error: "League not found" }, { status: 404 });
  }

  if (!(await isLeagueCommissioner(leagueId, auth.identity))) {
    return NextResponse.json({ error: "Only the commissioner can change league settings." }, { status: 403 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid league settings." }, { status: 400 });
  }

  const settings = await updateLeagueSettings(leagueId, parsed.data);
  void recordAuditEvent({
    action: "league.settings_update",
    actor: auth.identity,
    entityType: "league",
    entityId: leagueId,
    leagueId,
    detail: { changes: parsed.data },
    request,
  });
  return NextResponse.json({ leagueId, settings });
}
