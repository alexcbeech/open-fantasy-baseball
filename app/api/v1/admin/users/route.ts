import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { isDatabaseConfigured } from "@/lib/db/client";
import { isRateLimited } from "@/lib/rate-limit";
import { accountCommandSchema } from "@/lib/data/admin-user-schema";
import { AccountChangeError, changeAccount, listAdminUsers } from "@/lib/data/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const admin = await requireAdminUser();
  if (admin.response) return admin.response;
  try {
    return NextResponse.json({ users: await listAdminUsers(new URL(request.url).searchParams.get("search")?.slice(0, 200)),
      currentUserId: admin.user.userId, configured: isDatabaseConfigured() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Users are temporarily unavailable. Try reloading." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const admin = await requireAdminUser();
  if (admin.response) return admin.response;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (isRateLimited(`admin-users:${admin.user.userId}`, { limit: 20, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429 });
  }
  const parsed = accountCommandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid user, action, revision, and optional reason (up to 1,000 characters)." }, { status: 400 });
  try {
    return NextResponse.json(await changeAccount(parsed.data, admin.user, request));
  } catch (error) {
    return NextResponse.json({ error: error instanceof AccountChangeError ? error.message : "Account change could not be confirmed. Reload users before retrying." },
      { status: error instanceof AccountChangeError ? error.status : 503 });
  }
}
