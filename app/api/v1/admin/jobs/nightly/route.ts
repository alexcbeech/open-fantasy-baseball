import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { recordAuditEvent } from "@/lib/data/audit";
import { isDatabaseConfigured } from "@/lib/db/client";
import { enqueue, getJob } from "@/lib/jobs/queue";
import { drainQueue } from "@/lib/jobs/runner";

export const runtime = "nodejs";

// Admin manual trigger: enqueue a nightly_processing job and drain the durable
// queue immediately. Unlike the scheduled run it does not dedup by day, so an
// admin can re-run on demand (nightly processing is idempotent). Returns the
// drain counts plus the nightly job's own summary for the ops panel.
export async function POST(request: Request) {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is required for nightly processing." }, { status: 400 });
  }

  const { id } = await enqueue("nightly_processing");
  const drain = await drainQueue();
  const job = id ? await getJob(id) : null;

  void recordAuditEvent({
    action: "admin.run_nightly",
    actor: admin.user ? { userId: admin.user.userId, email: admin.user.email } : null,
    detail: { jobId: id ?? null },
    request,
  });

  return NextResponse.json({ drain, summary: job?.result ?? null }, { status: 202 });
}
