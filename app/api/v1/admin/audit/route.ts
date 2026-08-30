import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { isUuid } from "@/lib/db/client";
import { listAuditEventPage } from "@/lib/data/audit";

/** Admin-only: newest-first audit events, filterable by action prefix and actor. */
export async function GET(request: Request) {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const beforeId = url.searchParams.get("beforeId");
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);

  if ((before && Number.isNaN(Date.parse(before))) || (beforeId && (!before || !isUuid(beforeId)))) {
    return NextResponse.json({ error: "Invalid audit pagination cursor." }, { status: 400 });
  }

  const page = await listAuditEventPage({
    action: url.searchParams.get("action") ?? undefined,
    actorEmail: url.searchParams.get("actor") ?? undefined,
    before: before ?? undefined,
    beforeId: beforeId && isUuid(beforeId) ? beforeId : undefined,
    limit: Number.isNaN(limitParam) ? undefined : limitParam,
  });

  return NextResponse.json(page);
}
