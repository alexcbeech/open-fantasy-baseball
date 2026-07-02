import { NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/auth/bearer-token";
import { getLeagueSettings } from "@/lib/data/leagues";
import { commissionerEditableSettings } from "@/lib/fantasy/defaults";
import { getSettingsForScoringType } from "@/lib/fantasy/settings-matrix";

type RouteContext = {
  params: Promise<{
    leagueId: string;
  }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  const auth = await authorizeApiRequest(_request, "read:league", { allowMissingBearer: true });

  if (auth.response) {
    return auth.response;
  }

  const { leagueId } = await params;
  const settings = await getLeagueSettings(leagueId);

  return NextResponse.json({
    leagueId,
    settings,
    editableSettings: commissionerEditableSettings,
    settingDefinitions: getSettingsForScoringType(settings.scoringType),
  });
}
