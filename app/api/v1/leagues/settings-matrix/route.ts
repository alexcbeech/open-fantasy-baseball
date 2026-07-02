import { NextResponse } from "next/server";
import { commissionerSettingsMatrix, getSettingsForScoringType } from "@/lib/fantasy/settings-matrix";
import type { LeagueScoringType } from "@/lib/fantasy/types";

const scoringTypes: LeagueScoringType[] = ["h2h-categories", "h2h-points", "roto"];

export function GET(request: Request) {
  const url = new URL(request.url);
  const scoringType = url.searchParams.get("scoringType") as LeagueScoringType | null;

  if (scoringType && !scoringTypes.includes(scoringType)) {
    return NextResponse.json({ error: "Unsupported scoring type" }, { status: 400 });
  }

  return NextResponse.json({
    settings: scoringType ? getSettingsForScoringType(scoringType) : commissionerSettingsMatrix,
  });
}
