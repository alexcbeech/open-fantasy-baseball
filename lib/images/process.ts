import sharp from "sharp";
import { IMAGE_SIZE, IMAGE_TYPES, ImageUploadError, MAX_IMAGE_PIXELS, MAX_STORED_BYTES, MAX_UPLOAD_BYTES } from "./limits";

// libvips may expose only the first APNG frame. Check its animation-control
// chunk explicitly instead of treating that frame as an ordinary PNG.
function isAnimatedPng(input: Buffer) {
  for (let offset = 8; offset + 12 <= input.length;) {
    const length = input.readUInt32BE(offset);
    if (length > input.length - offset - 12) break;
    const type = input.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") break;
    offset += length + 12;
  }
  return false;
}

/** Bound the actual body, including chunked requests and dishonest Content-Length headers. */
export async function readImageBody(request: Request): Promise<Buffer> {
  if (!IMAGE_TYPES.includes(request.headers.get("content-type")?.split(";")[0] ?? "")) {
    throw new ImageUploadError("Choose a JPG, PNG, or WebP image.", 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES) {
    throw new ImageUploadError("Choose an image smaller than 4 MB.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ImageUploadError("Choose an image to upload.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new ImageUploadError("Choose an image smaller than 4 MB.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new ImageUploadError("Choose an image to upload.");
  return Buffer.concat(chunks);
}

export async function prepareImage(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > MAX_UPLOAD_BYTES) throw new ImageUploadError("Choose an image smaller than 4 MB.", 413);
  try {
    const options = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "warning" as const };
    const metadata = await sharp(input, options).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1
      || (metadata.format === "png" && isAnimatedPng(input))) {
      throw new ImageUploadError("Choose a still JPG, PNG, or WebP image. Animated images are not supported.", 415);
    }
    // Auto-orient before resizing. Keep the whole logo and transparent background;
    // sharp strips EXIF/GPS metadata unless explicitly asked to retain it.
    const image = sharp(input, options).rotate().resize(IMAGE_SIZE, IMAGE_SIZE, { fit: "inside", withoutEnlargement: true });
    for (const quality of [80, 60, 40]) {
      const output = await image.clone().webp({ quality }).toBuffer();
      if (output.length <= MAX_STORED_BYTES) return output;
    }
    throw new ImageUploadError("This image could not be compressed enough. Choose a simpler image.");
  } catch (error) {
    if (error instanceof ImageUploadError) throw error;
    throw new ImageUploadError("This image could not be read. Choose a valid JPG, PNG, or WebP under 20 megapixels.");
  }
}
