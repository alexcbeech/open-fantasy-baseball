import { expect, test } from "@playwright/test";

// Demo/mock mode serves a frozen mid-round-3 snake draft for league-1 (see
// lib/draft/mock-draft.ts), so the room renders read-only without a database.

test.describe("draft room (mock draft)", () => {
  test("renders the clock banner, ADP-ranked players, and pick ticker", async ({ page }) => {
    await page.goto("/draft/league-1");

    // On-the-clock banner: the mock viewer's own team is up.
    await expect(page.getByText(/on the clock/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Golden Sombreros").first()).toBeVisible();

    // Recent picks ticker shows round.pick chips.
    await expect(page.locator(".draft-ticker-chip").first()).toBeVisible();

    // Players tab lists undrafted players ranked with ADP context.
    await expect(page.getByPlaceholder("Search available players")).toBeVisible();
    await expect(page.locator(".draft-adp-rank").first()).toBeVisible();
  });

  test("shows the round-by-round board grid", async ({ page }) => {
    await page.goto("/draft/league-1");

    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Draft Board" })).toBeVisible();
    // Two completed mock rounds plus the round-3 cursor.
    await expect(page.locator(".draft-cell-pick").first()).toBeVisible();
    await expect(page.locator(".draft-cell.current")).toHaveCount(1);
  });

  test("shows my picks and remaining needs", async ({ page }) => {
    await page.goto("/draft/league-1");

    await page.getByRole("button", { name: "My Team", exact: true }).click();
    await expect(page.getByRole("heading", { name: "My Picks" })).toBeVisible();
    // Round 1-2 mock picks exist for the viewer's team; needs chips render.
    await expect(page.locator(".draft-need-chip").first()).toBeVisible();
  });

  test("blocks drafting in demo mode with a clear error", async ({ page }) => {
    await page.goto("/draft/league-1");

    // Open the pick sheet from the first available player row.
    await page.locator("button.players-row").first().click();
    const sheet = page.getByRole("dialog", { name: "Draft Player" });
    await expect(sheet).toBeVisible();

    // The mock viewer is commissioner, so the button is enabled; the mutating
    // route then rejects because no database is configured.
    await sheet.getByRole("button", { name: /Draft with pick/ }).click();
    await expect(page.getByText(/requires a configured database/i)).toBeVisible();
  });
});
