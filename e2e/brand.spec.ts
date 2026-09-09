import { expect, test } from "@playwright/test";

test("home plate stays prominent without overflowing the header", async ({ page }) => {
  for (const width of [320, 393, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    const logo = page.getByRole("img", { name: "Open Fantasy Baseball", exact: true });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveCSS("width", "56px");
    expect(await logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const mark = await logo.boundingBox();
    const actions = await page.locator(".topbar-actions").boundingBox();
    expect(mark!.x + mark!.width).toBeLessThanOrEqual(actions!.x);
  }
});
