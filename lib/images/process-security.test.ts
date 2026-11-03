import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { prepareImage } from "./process";

vi.mock("sharp", () => ({ default: vi.fn() }));

describe("upload decoder boundary", () => {
  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
    "GIF89a",
    "not an image",
  ])("rejects unsupported bytes before invoking Sharp: %s", async input => {
    await expect(prepareImage(Buffer.from(input))).rejects.toMatchObject({ status: 415 });
    expect(sharp).not.toHaveBeenCalled();
  });
});
