import { expect, it, vi } from "vitest";
const remove = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ del: remove, put: vi.fn() }));
import { removeStoredImage } from "./storage";
it("cleans only this owner's uploaded blob, never a provider image or another owner's image", async () => {
  const target = { kind: "profile" as const, id: "owner" };
  await removeStoredImage(target, "https://provider.test/avatar.png");
  await removeStoredImage(target, "https://store.public.blob.vercel-storage.com/ofb-images/profile/other/image.webp");
  expect(remove).not.toHaveBeenCalled();
  const url = "https://store.public.blob.vercel-storage.com/ofb-images/profile/owner/image-random.webp";
  await removeStoredImage(target, url);
  expect(remove).toHaveBeenCalledExactlyOnceWith(url);
});
