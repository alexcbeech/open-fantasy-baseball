import { expect, test } from "@playwright/test";
import { lineupToday, shiftLineupDate } from "../lib/fantasy/lineup-date";

test("past lineups lock moves; future moves send the chosen date", async ({ page }) => {
  const today = lineupToday();
  const tomorrow = shiftLineupDate(today, 1);
  await page.goto(`/team/team-1?date=${shiftLineupDate(today, -1)}`);
  await expect(page.getByText("Past lineup · locked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Adley Rutschman: read-only lineup" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start Active Players" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "View day" })).toHaveCount(0);
  await page.getByLabel("Lineup date", { exact: true }).fill("");
  await expect(page).toHaveURL(new RegExp(`date=${shiftLineupDate(today, -1)}$`));
  await page.getByLabel("Lineup date", { exact: true }).fill(tomorrow);
  await expect(page).toHaveURL(new RegExp(`date=${tomorrow}$`));
  await expect(page.getByLabel("Lineup date", { exact: true })).toHaveValue(tomorrow);
  await page.getByRole("button", { name: /Move Adley Rutschman out of the C slot/ }).click();
  const save = page.waitForRequest((request) => request.url().includes("/lineup") && request.method() === "PATCH");
  await page.getByRole("dialog", { name: "Move Player" }).getByText("Open UTIL spot").click();
  expect((await save).postDataJSON().date).toBe(tomorrow);
  await expect(page.getByRole("button", { name: /Move Adley Rutschman out of the UTIL slot/ })).toBeVisible();
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page.getByLabel("Lineup date", { exact: true })).toHaveValue(today);
  await expect(page.getByRole("button", { name: /Move Adley Rutschman out of the C slot/ })).toBeVisible();
});
