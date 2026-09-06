import { IMAGE_SIZE } from "./limits";

export type ImageCrop = { x: number; y: number; zoom: number };

export function calculateSquareCrop(width: number, height: number, crop: ImageCrop) {
  if (width <= 0 || height <= 0 || crop.zoom < 1) throw new Error("The image is not ready to crop.");
  const size = Math.min(width, height) / crop.zoom;
  return {
    x: Math.max(0, Math.min(width - size, crop.x * (width - size))),
    y: Math.max(0, Math.min(height - size, crop.y * (height - size))),
    size,
  };
}

export function cropImageToBlob(image: HTMLImageElement, crop: ImageCrop): Promise<Blob> {
  const source = calculateSquareCrop(image.naturalWidth, image.naturalHeight, crop);
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_SIZE;
  canvas.height = IMAGE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot crop the image.");
  context.drawImage(image, source.x, source.y, source.size, source.size, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The cropped image could not be created.")),
    "image/webp",
    0.9,
  ));
}
