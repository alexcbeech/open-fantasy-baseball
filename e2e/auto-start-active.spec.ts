import { expect, test } from "@playwright/test";

test("lineup help opens and dismisses with keyboard", async ({ page }) => {
  await page.goto("/team/team-1");
  await page.getByRole("button", { name: "About Start Active Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Start Active Players", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Start Active Players" })).toBeInViewport();
  await expect(dialog).toContainText("probable starters");
  await expect(dialog).toContainText("during each nightly update");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("toggle shows confirmed status and retains it when saving fails", async ({ page }) => {
  await page.goto("/team/team-1");
  let fail = false;
  await page.route("**/api/v1/teams/team-1/auto-start-active", async (route) => {
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: "Please try again." } : { enabled: route.request().postDataJSON().enabled } });
  });
  const toggle = page.getByRole("switch", { name: "Auto-start active", exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByText("Auto-start active is ON · Runs nightly")).toBeVisible();
  fail = true;
  await toggle.click();
  await expect(page.getByRole("alert").filter({ hasText: "Please try again." })).toBeVisible();
  await expect(toggle).toBeChecked();
  fail = false;
  await toggle.click();
  await expect(toggle).not.toBeChecked();
});
