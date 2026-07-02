import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { isDatabaseConfigured } from "@/lib/db/client";
import { syncMlbTeamsAndRosters } from "@/lib/data/mlb-sync";

export async function POST() {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is required for MLB sync." }, { status: 400 });
  }

  const result = await syncMlbTeamsAndRosters();

  return NextResponse.json({
    source: "mlb-stats-api",
    ...result,
  });
}
