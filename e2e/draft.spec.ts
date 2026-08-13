import { expect, test } from "@playwright/test";

// Demo/mock mode serves a frozen mid-round-3 snake draft for league-1 (see
// lib/draft/mock-draft.ts), so the room renders read-only without a database.

test.describe("draft room (mock draft)", () => {
  test("renders the clock banner, ADP-ranked players, and pick ticker", async ({ page }) => {
    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("Hydration failed")) {
        hydrationErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (error.message.includes("Hydration failed")) {
        hydrationErrors.push(error.message);
      }
    });

    await page.goto("/draft/league-1");

    // On-the-clock banner: the mock viewer's own team is up.
    await expect(page.getByText(/on the clock/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Golden Sombreros").first()).toBeVisible();

    // Recent picks ticker shows round.pick chips.
    await expect(page.locator(".draft-ticker-chip").first()).toBeVisible();

    // Players tab lists undrafted players ranked with ADP context.
    await expect(page.getByPlaceholder("Search available players")).toBeVisible();
    await expect(page.locator(".draft-adp-rank").first()).toBeVisible();
    expect(hydrationErrors).toEqual([]);
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

  test("opens queued players for drafting and exposes reorder controls", async ({ page }) => {
    await page.goto("/draft/league-1");

    await page.getByRole("button", { name: "My Team", exact: true }).click();
    const queuedPlayer = page.getByRole("button", { name: /View Elly De La Cruz and draft/ });
    await expect(queuedPlayer).toBeVisible();
    await expect(page.getByRole("button", { name: /Move Elly De La Cruz down in queue/ })).toBeEnabled();
    await queuedPlayer.click();

    const sheet = page.getByRole("dialog", { name: "Draft Player" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Draft with pick/ })).toBeEnabled();
    await expect(sheet.getByText(/Season: .*HR/)).toBeVisible();
  });

  test("blocks drafting in demo mode with a clear error", async ({ page }) => {
    await page.goto("/draft/league-1");

    // Open the pick sheet from the first available player row. The row is a
    // div wrapper; its clickable body is button.players-row-main.
    await page.locator("button.players-row-main").first().click();
    const sheet = page.getByRole("dialog", { name: "Draft Player" });
    await expect(sheet).toBeVisible();

    // The mock viewer is commissioner, so the button is enabled; the mutating
    // route then rejects because no database is configured. This is the first
    // hit to the draft-pick API route, which Next compiles on demand under the
    // dev server, so allow extra time for the rejection banner to appear.
    await sheet.getByRole("button", { name: /Draft with pick/ }).click();
    await expect(page.getByText(/requires a configured database/i)).toBeVisible({ timeout: 15_000 });
  });
});
