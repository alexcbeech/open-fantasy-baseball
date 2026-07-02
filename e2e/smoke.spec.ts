import { expect, test } from "@playwright/test";

// These run against the app in demo/mock mode (see playwright.config.ts), so
// the seeded mock league is present and no sign-in is required.

test.describe("mobile landing", () => {
  test("shows the roster summary and team cards", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "My Teams" })).toBeVisible();
    await expect(page.getByText("Teams", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Golden Sombreros/ })).toBeVisible();
  });
});

test.describe("team tabs", () => {
  test("navigates Team, Matchup, Players, and League", async ({ page }) => {
    await page.goto("/team/team-1");
    await expect(page.getByRole("heading", { name: "Golden Sombreros" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lineup", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Matchup", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Category Score" })).toBeVisible();

    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expect(page.getByPlaceholder("Search all players")).toBeVisible();

    await page.getByRole("link", { name: "League", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Commissioner" })).toBeVisible();
  });
});

test.describe("lineup move sheet", () => {
  test("moves a player through the eligible-slot sheet", async ({ page }) => {
    await page.goto("/team/team-1");

    await page.getByRole("button", { name: /Move Adley Rutschman out of the C slot/ }).click();

    const sheet = page.getByRole("dialog", { name: "Move Player" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/new position for Adley Rutschman/)).toBeVisible();

    // A catcher may flex to UTIL/BN but never to shortstop or a pitching slot.
    await expect(sheet.getByText("Open UTIL spot")).toBeVisible();
    await expect(sheet.getByText(/Open SS spot/)).toHaveCount(0);
    await expect(sheet.getByText(/Open SP spot/)).toHaveCount(0);

    await sheet.getByText("Open UTIL spot").click();

    await expect(page.getByRole("dialog", { name: "Move Player" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Move Adley Rutschman out of the UTIL slot/ })).toBeVisible();

    // The vacated catcher slot now reads as an empty, fillable slot.
    const emptyCatcher = page.getByRole("button", { name: /Fill the empty C slot/ });
    await expect(emptyCatcher).toBeVisible();

    // Filling it offers the catcher back and returns him to C.
    await emptyCatcher.click();
    const fillSheet = page.getByRole("dialog", { name: /Fill C slot/ });
    await expect(fillSheet).toBeVisible();
    await fillSheet.getByText("Adley Rutschman").click();
    await expect(page.getByRole("button", { name: /Move Adley Rutschman out of the C slot/ })).toBeVisible();
  });
});

test.describe("player search", () => {
  test("filters the player pool by name", async ({ page }) => {
    await page.goto("/team/team-1?tab=players");

    const search = page.getByPlaceholder("Search all players");
    await expect(search).toBeVisible();
    await search.fill("Julio");

    await expect(page.getByText("Julio Rodriguez")).toBeVisible();
    await expect(page.getByText("Freddie Freeman")).toHaveCount(0);
  });
});

test.describe("commissioner settings", () => {
  test("shows commissioner controls on the League tab", async ({ page }) => {
    await page.goto("/team/team-1?tab=league");

    await expect(page.getByRole("heading", { name: "Commissioner" })).toBeVisible();
    await expect(page.getByText("Waivers")).toBeVisible();
    await expect(page.getByText("FAAB")).toBeVisible();
  });
});
