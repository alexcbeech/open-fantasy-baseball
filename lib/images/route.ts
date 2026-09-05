import { NextResponse } from "next/server";
import { resolveApiIdentity } from "@/lib/auth/api-identity";
import { requireTeamManager } from "@/lib/auth/team-access";
import { isDatabaseConfigured, isUuid } from "@/lib/db/client";
import { recordAuditEvent } from "@/lib/data/audit";
import { replaceImage, type ImageTarget } from "@/lib/data/images";
import { isRateLimited } from "@/lib/rate-limit";
import { ImageUploadError } from "./limits";
import { prepareImage, readImageBody } from "./process";
import { isImageStorageConfigured, removeStoredImage, storeImage } from "./storage";

export async function handleImageRequest(request: Request, teamId?: string) {
  const auth = await resolveApiIdentity(request, teamId ? "write:team" : "write:profile");
  if (auth.response) return auth.response;
  if (teamId) {
    const denied = await requireTeamManager(teamId, auth.identity);
    if (denied) return denied;
  }
  // Browser requests must come from this app. Bearer API calls can omit Origin.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Upload from this app's page." }, { status: 403 });
  }
  if (isRateLimited(`image:${auth.identity.userId}`, { limit: 10, windowMs: 60 * 60 * 1000 })) {
    return NextResponse.json({ error: "Too many image changes. Try again in an hour." }, { status: 429, headers: { "Retry-After": "3600" } });
  }
  if (!isDatabaseConfigured() || !isImageStorageConfigured()) {
    return NextResponse.json({ error: "Image uploads are not configured yet." }, { status: 503 });
  }
  const target: ImageTarget = { kind: teamId ? "team" : "profile", id: teamId ?? auth.identity.userId };
  if (!isUuid(target.id)) return NextResponse.json({ error: "A signed-in account is required." }, { status: 401 });
  try {
    const image = request.method === "DELETE" ? null : await prepareImage(await readImageBody(request));
    const blob = image ? await storeImage(target, image) : null;
    const previous = await replaceImage(target, blob?.url ?? null);
    // Do not roll back a saved picture if cleanup is temporarily unavailable.
    await removeStoredImage(target, previous).catch(() => console.warn("Previous image cleanup failed.", target.kind, target.id));
    await recordAuditEvent({
      action: `${target.kind}.image.${image ? "upload" : "remove"}`,
      actor: auth.identity, entityType: target.kind, entityId: target.id,
      ...(teamId ? { teamId } : {}), detail: { bytes: image?.length ?? 0 }, request,
    });
    return NextResponse.json({ url: blob?.url ?? null });
  } catch (error) {
    if (error instanceof ImageUploadError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.warn("Image save failed.", target.kind, target.id);
    return NextResponse.json({ error: "The image could not be saved. Please try again." }, { status: 503 });
  }
}
