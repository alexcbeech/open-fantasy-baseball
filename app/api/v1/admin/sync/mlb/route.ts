import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { recordAuditEvent } from "@/lib/data/audit";
import { isDatabaseConfigured } from "@/lib/db/client";
import { syncMlbTeamsAndRosters } from "@/lib/data/mlb-sync";

export async function POST(request: Request) {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is required for MLB sync." }, { status: 400 });
  }

  const result = await syncMlbTeamsAndRosters();

  void recordAuditEvent({
    action: "admin.sync_mlb",
    actor: admin.user ? { userId: admin.user.userId, email: admin.user.email } : null,
    request,
  });

  return NextResponse.json({
    source: "mlb-stats-api",
    ...result,
  });
}
