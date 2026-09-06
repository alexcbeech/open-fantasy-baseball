// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { calculateSquareCrop, cropImageToBlob } from "./crop-client";

it("calculates a positioned square within a landscape image", () => {
  expect(calculateSquareCrop(1200, 800, { x: 0.75, y: 0.5, zoom: 2 })).toEqual({
    x: 600,
    y: 200,
    size: 400,
  });
});

it("renders the selected crop to a 256px WebP", async () => {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["crop"], { type: "image/webp" })));
  const image = document.createElement("img");
  Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });

  const result = await cropImageToBlob(image, { x: 0.75, y: 0.5, zoom: 2 });

  expect(result.type).toBe("image/webp");
  expect(drawImage).toHaveBeenCalledWith(image, 600, 200, 400, 400, 0, 0, 256, 256);
});
