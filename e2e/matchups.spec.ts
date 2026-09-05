import { expect, test } from "@playwright/test";

test("browse league matchups and past/future weeks on mobile", async ({ page }) => {
  await page.goto("/team/team-1?tab=matchup");
  const allMatchups = page.getByRole("button", { name: /All Matchups/ });
  await expect(allMatchups).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: /Moon Shots/ })).toBeHidden();
  await expect(page.locator(".matchup-hero")).toBeVisible();
  await allMatchups.click();
  await expect(allMatchups).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: /Moon Shots/ })).toBeVisible();
  await allMatchups.click();
  await expect(page.getByRole("link", { name: /Moon Shots/ })).toBeHidden();
  await allMatchups.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Scoring period", { exact: true })).toHaveValue("demo-week-13");
  await page.getByRole("link", { name: /Moon Shots/ }).click();
  await expect(page.locator(".matchup-hero")).toContainText("Moon Shots");
  await expect(page.locator(".matchup-hero")).toContainText("Basepath Bandits");
  await expect(allMatchups).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("link", { name: /Moon Shots/ })).toBeHidden();

  await page.getByRole("link", { name: "← Previous" }).click();
  await expect(page.getByLabel("Scoring period", { exact: true })).toHaveValue("demo-week-12");
  await expect(page.getByRole("link", { name: "← Previous" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Category Breakdown" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Starters Head to Head" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Player Matchup Points" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Golden Sombreros player matchup points" })).toContainText("Adley Rutschman");

  await page.getByLabel("Scoring period", { exact: true }).selectOption("demo-week-14");
  await expect(page.getByRole("button", { name: "View", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/tab=matchup&period=demo-week-14$/);
  await expect(page.getByText("This matchup has not started yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Next →" })).toHaveCount(0);
  await expect(page.locator(".matchup-hero-score").first()).toHaveText("—");
  await expect(page.getByRole("heading", { name: "Player Matchup Points" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Scoring period", { exact: true })).toHaveValue("demo-week-14");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("past and upcoming details ignore current live scores", async ({ page }) => {
  await page.route("**/matchup/live", (route) => route.fulfill({ json: { update: {
    live: true, hasTodayStats: true, userScore: 999, opponentScore: 888, categoryScores: [], livePoints: { "player-1": 999 },
  } } }));
  await page.goto("/team/team-1?tab=matchup&period=demo-week-12");
  await expect(page.locator(".matchup-hero-score").first()).toHaveText("6");
  await expect(page.getByRole("table", { name: "Golden Sombreros player matchup points" })).not.toContainText("999");
  await page.getByRole("link", { name: "Next →" }).click();
  await expect(page.locator(".matchup-hero-score").first()).toHaveText("999");
  await page.getByRole("link", { name: "Next →" }).click();
  await expect(page.locator(".matchup-hero-score").first()).toHaveText("—");
});
