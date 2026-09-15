import { expect, test } from "@playwright/test";

test("league creation offers bot playoff eligibility enabled by default", async ({ page }) => {
  await page.goto("/league/new");
  const toggle = page.getByRole("checkbox", { name: "Allow bots to make the playoffs (head-to-head leagues)", exact: true });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
});
