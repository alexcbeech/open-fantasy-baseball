import { expect, test } from "@playwright/test";

test("consolation final is distinct from the championship and survives reload", async ({ page }) => {
  await page.goto("/team/team-1?tab=matchup&period=demo-week-14");
  await page.getByRole("button", { name: /All Matchups/ }).click();
  const consolation = page.getByRole("link", { name: /Moon Shots/ });
  await expect(consolation).toContainText("Consolation");
  await consolation.click();
  await expect(page.getByText("Consolation Final", { exact: true })).toBeVisible();
  await expect(page.getByText("This matchup has not started yet.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Consolation Final", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/team/team-1?tab=league");
  await expect(page.getByText(/Other teams play seeded consolation brackets/)).toBeVisible();
});
