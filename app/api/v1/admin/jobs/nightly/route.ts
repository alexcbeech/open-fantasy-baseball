import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { isDatabaseConfigured } from "@/lib/db/client";
import { runNightlyProcessing } from "@/lib/jobs/nightly-processing";

export const runtime = "nodejs";

export async function POST() {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is required for nightly processing." }, { status: 400 });
  }

  const summary = await runNightlyProcessing();

  return NextResponse.json({ summary }, { status: 202 });
}
