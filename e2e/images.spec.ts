import { expect, test } from "@playwright/test";

test("profile and team image controls explain unconfigured storage without a broken upload", async ({ page }) => {
  await page.goto("/profile");
  await page.getByText("Edit profile picture", { exact: true }).click();
  await expect(page.getByText("Image uploads are not configured yet.")).toBeVisible();
  await expect(page.getByText(/256 × 256/)).toBeVisible();
  await page.goto("/team/team-1");
  await page.getByText("Edit team logo", { exact: true }).click();
  await expect(page.getByText("Image uploads are not configured yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload image" })).toHaveCount(0);
});
