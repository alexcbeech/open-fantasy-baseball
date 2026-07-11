import { expect, test } from "@playwright/test";

// These run against the app in demo/mock mode (see playwright.config.ts), so
// the seeded mock league is present and no sign-in is required.

test.describe("mobile landing", () => {
  test("shows the roster summary and team cards", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "My Teams" })).toBeVisible();
    // Every team the user manages is listed as a card.
    await expect(page.getByRole("link", { name: /Golden Sombreros/ })).toBeVisible();
  });
});

test.describe("team tabs", () => {
  test("navigates Team, Matchup, Players, and League", async ({ page }) => {
    await page.goto("/team/team-1");
    await expect(page.getByRole("heading", { name: "Golden Sombreros" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lineup", exact: true })).toBeVisible();
    // Yahoo-style lineup: Batters/Pitchers sections and player headshots.
    await expect(page.getByText("Batters", { exact: true })).toBeVisible();
    await expect(page.getByText("Pitchers", { exact: true })).toBeVisible();
    await expect(page.locator(".lineup-list .player-avatar").first()).toBeVisible();
    // Lineups auto-validate on each move, so the manual "Validate Moves" step
    // and the Lineup Status pane are gone; the lineup fills that space.
    await expect(page.getByRole("button", { name: "Validate Moves" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Lineup Status" })).toHaveCount(0);

    await page.getByRole("link", { name: "Matchup", exact: true }).click();
    // The Matchup tab is a client component (live category recalc); allow for the
    // dev server compiling it on first hit.
    await expect(page.getByRole("heading", { name: "Category Breakdown" })).toBeVisible({ timeout: 20000 });

    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expect(page.getByPlaceholder("Search all players")).toBeVisible();

    await page.getByRole("link", { name: "League", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Standings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Commissioner" })).toBeVisible();
  });

  test("flags players carrying recent news with a row icon", async ({ page }) => {
    await page.goto("/team/team-1");

    // The Player Watch button is gone; recent news is a per-row icon whose
    // accessible name carries the headline (the detail sheet has the story).
    await expect(page.getByRole("heading", { name: "Lineup", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Player Watch/ })).toHaveCount(0);

    const newsIcon = page.getByRole("img", { name: "Recent news: Homered and stole a base in Monday's win." });
    await expect(newsIcon).toBeVisible();
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

  test("opens the player detail sheet when tapping the player", async ({ page }) => {
    await page.goto("/team/team-1");

    await page.getByRole("button", { name: /View Adley Rutschman details/ }).click();

    const detail = page.getByRole("dialog", { name: "Player detail" });
    await expect(detail).toBeVisible();
    // The detail body loads via fetch; allow for the dev server compiling the
    // /api/v1/players/[playerId] route on first hit.
    await expect(detail.getByRole("heading", { name: "Adley Rutschman" })).toBeVisible({ timeout: 20000 });
    await expect(detail.getByRole("button", { name: "Drop" })).toBeVisible();

    // Tabbed Yahoo-style card: Overview shows first, Stats tab reveals windows.
    await expect(detail.getByRole("tab", { name: "Overview" })).toBeVisible();
    await detail.getByRole("tab", { name: "Stats" }).click();
    await expect(detail.getByRole("heading", { name: "Stats" })).toBeVisible();
    // Stats render as a Yahoo-style table with a Split column and a Season row.
    await expect(detail.getByRole("columnheader", { name: "Split" })).toBeVisible();
    await expect(detail.getByRole("rowheader", { name: "Season" })).toBeVisible();
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

  test("opens the shared player detail popup from a player row", async ({ page }) => {
    await page.goto("/team/team-1?tab=players");

    await page.getByRole("button", { name: /View Julio Rodriguez details/ }).click();

    // Same tabbed detail sheet the Team tab uses (dialog + Overview/Game Log/Stats tabs).
    const detail = page.getByRole("dialog", { name: "Player detail" });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: "Julio Rodriguez" })).toBeVisible({ timeout: 20000 });
    await expect(detail.getByRole("tab", { name: "Game Log" })).toBeVisible();
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
