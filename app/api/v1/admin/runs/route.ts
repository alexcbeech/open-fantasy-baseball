import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { listAdminRunHistory } from "@/lib/data/admin-runs";

export async function GET() {
  const admin = await requireAdminUser();

  if (admin.response) {
    return admin.response;
  }

  const history = await listAdminRunHistory();

  return NextResponse.json({ history });
}
