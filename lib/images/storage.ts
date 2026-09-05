import { del, put } from "@vercel/blob";
import type { ImageTarget } from "@/lib/data/images";

export function isImageStorageConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function prefix(target: ImageTarget) { return `ofb-images/${target.kind}/${target.id}/`; }

export async function storeImage(target: ImageTarget, image: Buffer) {
  return put(`${prefix(target)}image.webp`, image, {
    access: "public", addRandomSuffix: true, contentType: "image/webp",
    cacheControlMaxAge: 31536000,
  });
}

/** Never delete login-provider images or blobs belonging to another owner. */
export async function removeStoredImage(target: ImageTarget, url: string | null) {
  if (!url) return;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".public.blob.vercel-storage.com")
    || !parsed.pathname.startsWith(`/${prefix(target)}`)) return;
  await del(url);
}
