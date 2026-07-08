import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireLeagueViewer } from "@/lib/auth/team-access";
import { getLeagueSettings } from "@/lib/data/leagues";
import { commissionerEditableSettings } from "@/lib/fantasy/defaults";
import { getSettingsForScoringType } from "@/lib/fantasy/settings-matrix";

type RouteContext = {
  params: Promise<{
    leagueId: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
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
}
