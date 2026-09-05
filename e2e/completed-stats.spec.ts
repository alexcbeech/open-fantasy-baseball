import { expect, test } from "@playwright/test";

test("completed games retain team stat lines and appear in the player game log", async ({ page }) => {
  const stats = { H: 2, AB: 4, R: 1, HR: 1, RBI: 3 };
  let final = false;
  await page.route("**/teams/team-2/live", (route) => {
    const entry = { state: final ? "Final" : "Bottom 7th", stats, points: 21.7 };
    return route.fulfill({ json: { live: final ? {} : { "player-6": entry }, today: { "player-6": entry }, lineups: {} } });
  });
  await page.route("**/players/player-6/live", (route) => route.fulfill({ json: { status: {
    live: false, state: null, stats: {}, points: null,
    todayGames: [{ id: "today", gamePk: 123456, date: "2026-09-05T00:00:00Z", stats }],
  } } }));
  await page.goto("/team/team-2");
  const player = page.getByRole("button", { name: "View Adley Rutschman details" });
  await expect(player).toContainText("Bottom 7th");
  await expect(player.locator(".player-live-line")).toBeVisible();
  final = true;
  await page.reload();
  await expect(player).toContainText("Final");
  await expect(player.locator(".player-live-line")).toContainText("HR");
  await expect(player.locator(".is-live")).toHaveCount(0);
  await player.click();
  const sheet = page.getByRole("dialog", { name: "Player detail" });
  await sheet.getByRole("tab", { name: "Game Log" }).click();
  await expect(sheet.getByRole("row").filter({ hasText: "2/4" })).toHaveCount(1);
});
