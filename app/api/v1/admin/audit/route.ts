import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { listAuditEvents } from "@/lib/data/audit";

/** Admin-only: newest-first audit events, filterable by action prefix and actor. */
export async function GET(request: Request) {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);

  const events = await listAuditEvents({
    action: url.searchParams.get("action") ?? undefined,
    actorEmail: url.searchParams.get("actor") ?? undefined,
    before: before && !Number.isNaN(Date.parse(before)) ? before : undefined,
    limit: Number.isNaN(limitParam) ? undefined : limitParam,
  });

  return NextResponse.json({ events });
}
