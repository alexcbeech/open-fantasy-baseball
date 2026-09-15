import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth/admin";
import { isRateLimited } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/data/audit";
import { announcementContentSchema } from "@/lib/data/admin-announcement-schema";
import { AnnouncementError, announcementSettings, createAdminAnnouncement, listAdminAnnouncements, processAdminAnnouncement,
  queueAdminAnnouncement, reviewAnnouncementAudience, saveAdminAnnouncement, testAdminAnnouncement } from "@/lib/data/admin-announcements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const reference = { id: z.uuid(), revision: z.number().int().nonnegative() };
const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("save"), ...reference, content: announcementContentSchema }),
  z.object({ action: z.literal("review"), ...reference }),
  z.object({ action: z.literal("test"), ...reference }),
  z.object({ action: z.literal("send"), ...reference, audienceToken: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ action: z.literal("resume"), id: z.uuid() }),
]);
async function handle(request: Request) {
  const admin = await requireAdminUser();
  if (admin.response) return admin.response;
  const mutate = request.method === "POST";
  if (mutate) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    if (isRateLimited(`announcements:${admin.user.email}`, { limit: 20, windowMs: 60_000 })) {
      return NextResponse.json({ error: "Too many requests. Please wait a minute." }, { status: 429 });
    }
  }
  try {
    if (!mutate) return NextResponse.json({ announcements: await listAdminAnnouncements(), settings: announcementSettings(), testRecipient: admin.user.email }, { headers: { "Cache-Control": "no-store" } });
    const parsed = commandSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Provide a subject, message, and valid optional HTTPS button link." }, { status: 400 });
    const command = parsed.data;
    let id = "id" in command ? command.id : undefined;
    let audience;
    if (command.action === "create") id = await createAdminAnnouncement(admin.user.email);
    if (command.action === "save") await saveAdminAnnouncement(command.id, command.revision, command.content, admin.user.email);
    if (command.action === "review") audience = await reviewAnnouncementAudience();
    if (command.action === "test") {
      if (isRateLimited(`announcement-tests:${admin.user.email}`, { limit: 3, windowMs: 60_000 })) {
        return NextResponse.json({ error: "Please wait a minute before sending another test." }, { status: 429 });
      }
      await testAdminAnnouncement(command.id, command.revision, admin.user.email);
    }
    if (command.action === "send") await queueAdminAnnouncement(command.id, command.revision, command.audienceToken, admin.user.email);
    if (command.action === "send" || command.action === "resume") {
      after(async () => {
        try { await processAdminAnnouncement(command.id); }
        catch { await recordAuditEvent({ action: "announcement.processing_failed", actor: admin.user, entityType: "admin_announcement", entityId: command.id }); }
      });
    }
    await recordAuditEvent({ action: `announcement.${command.action}`, actor: admin.user, entityType: "admin_announcement", entityId: id, request });
    return NextResponse.json({ id, audience });
  } catch (error) {
    if (mutate) await recordAuditEvent({ action: "announcement.failed", actor: admin.user, request });
    return NextResponse.json({ error: error instanceof AnnouncementError ? error.message : "Announcements are temporarily unavailable. Reload before retrying." },
      { status: error instanceof AnnouncementError ? error.status : 503 });
  }
}
export const GET = handle;
export const POST = handle;
