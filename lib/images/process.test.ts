import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MAX_STORED_BYTES, MAX_UPLOAD_BYTES } from "./limits";
import { prepareImage, readImageBody } from "./process";

describe("small uploaded images", () => {
  it("reduces a 4K photo to a metadata-free WebP within both storage limits", async () => {
    const input = await sharp({ create: { width: 3840, height: 2160, channels: 3, background: "red" } }).jpeg().withMetadata().toBuffer();
    const result = await prepareImage(input);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(144);
    expect(meta.exif).toBeUndefined();
    expect(result.length).toBeLessThanOrEqual(MAX_STORED_BYTES);
  });
  it("preserves transparency and does not enlarge small logos", async () => {
    const input = await sharp({ create: { width: 60, height: 40, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0 } } }).png().toBuffer();
    const meta = await sharp(await prepareImage(input)).metadata();
    expect(meta).toMatchObject({ width: 60, height: 40, hasAlpha: true });
  });
  it("rejects oversized files and extreme pixel counts", async () => {
    await expect(prepareImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({ status: 413 });
    const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "red" } }).png().toBuffer();
    await expect(prepareImage(huge)).rejects.toThrow("20 megapixels");
  });
  it("rejects corrupt files, SVG content disguised as PNG, and animated WebP", async () => {
    await expect(prepareImage(Buffer.from("not an image"))).rejects.toThrow("could not be read");
    await expect(prepareImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'))).rejects.toMatchObject({ status: 415 });
    const frames = Buffer.concat([Buffer.alloc(12, 0), Buffer.alloc(12, 255)]);
    const animated = await sharp(frames, { raw: { width: 2, height: 4, channels: 3, pageHeight: 2 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(prepareImage(animated)).rejects.toMatchObject({ status: 415 });
  });
  it("bounds chunked bodies even if Content-Length lies", async () => {
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_UPLOAD_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close();
    } });
    const request = new Request("http://localhost/upload", { method: "PUT", headers: { "Content-Type": "image/png", "Content-Length": "1" }, body, duplex: "half" } as RequestInit);
    await expect(readImageBody(request)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects unsupported content types before reading the body", async () => {
    await expect(readImageBody(new Request("http://localhost/upload", { method: "PUT", body: "abc" }))).rejects.toMatchObject({ status: 415 });
  });
});
