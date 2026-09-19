import { expect, test } from "@playwright/test";

test("admin sections start collapsed, toggle independently with a keyboard, and reset on reload", async ({ page }) => {
  await page.goto("/admin");
  const sections = page.locator(".admin-section");
  await expect(sections).toHaveCount(11);
  await expect(page.locator(".admin-section details[open]")).toHaveCount(0);
  for (const section of await sections.all()) {
    await expect(section.locator("summary")).toBeVisible();
    await expect(section.locator(".admin-section-body")).toBeHidden();
    await section.locator("summary").click();
    await expect(section.locator(".admin-section-body")).toBeVisible();
    await section.locator("summary").click();
    await expect(section.locator(".admin-section-body")).toBeHidden();
  }
  const users = page.getByRole("region", { name: "Users", exact: true });
  await users.locator("summary").focus();
  await page.keyboard.press("Enter");
  await users.getByLabel("Find users").fill("unsaved search");
  await users.locator("summary").press("Space");
  await expect(users.getByLabel("Find users")).toBeHidden();
  await users.locator("summary").press("Enter");
  await expect(users.getByLabel("Find users")).toHaveValue("unsaved search");
  await page.getByRole("region", { name: "Nightly Window" }).locator("summary").click();
  await expect(page.locator(".admin-section details[open]")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".admin-section details[open]")).toHaveCount(0);
});
