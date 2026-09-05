import { expect, test } from "@playwright/test";

test("profile and team image controls explain unconfigured storage without a broken upload", async ({ page }) => {
  await page.goto("/profile");
  await page.getByText("Edit profile picture", { exact: true }).click();
  await expect(page.getByText("Image uploads are not configured yet.")).toBeVisible();
  await expect(page.getByText(/256 × 256/)).toBeVisible();
  await page.goto("/team/team-1");
  const logo = page.getByRole("button", { name: "Edit team logo", exact: true });
  const dialog = page.getByRole("dialog", { name: "Edit team logo" });
  await expect(dialog).not.toBeVisible();
  const logoBounds = await logo.boundingBox();
  const nameBounds = await page.getByRole("heading", { name: "Golden Sombreros", exact: true }).boundingBox();
  expect(logoBounds!.x + logoBounds!.width).toBeLessThan(nameBounds!.x);
  expect(Math.abs(logoBounds!.y - nameBounds!.y)).toBeLessThan(24);
  await logo.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Image uploads are not configured yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload image" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(logo).toBeFocused();
  await logo.click();
  await dialog.getByRole("button", { name: "Close image editor" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(logo).toBeFocused();
});
