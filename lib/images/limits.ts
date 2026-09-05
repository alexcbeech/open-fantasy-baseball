export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 20_000_000;
export const IMAGE_SIZE = 256;
export const MAX_STORED_BYTES = 100 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export class ImageUploadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
