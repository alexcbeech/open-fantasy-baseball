import { expect, test } from "@playwright/test";

test.describe("progressive web app", () => {
  test("publishes install metadata and production icons", async ({ page, request }) => {
    await page.goto("/");

    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute("href", /manifest\.webmanifest/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/);

    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBeTruthy();
    expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");
    await expect(manifestResponse.json()).resolves.toMatchObject({
      name: "Open Fantasy Baseball",
      short_name: "OFB",
      display: "standalone",
      start_url: "/",
    });

    for (const icon of ["icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png"]) {
      const iconResponse = await request.get(`/icons/${icon}`);
      expect(iconResponse.ok(), icon).toBeTruthy();
      expect(iconResponse.headers()["content-type"], icon).toContain("image/png");
      expect((await iconResponse.body()).byteLength, icon).toBeGreaterThan(1_000);
    }
  });

  test("registers the service worker globally and precaches the offline fallback", async ({ page }) => {
    test.skip(
      process.env.PLAYWRIGHT_PWA_PRODUCTION !== "1",
      "Service workers are intentionally disabled on the Next.js development server.",
    );
    await page.goto("/team/team-1");
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    expect(scope).toBe("http://localhost:3100/");

    const offlineHtml = await page.evaluate(async () => {
      const response = await caches.match("/offline.html");
      return response?.text();
    });
    expect(offlineHtml).toContain("You’re offline");
    expect(offlineHtml).toContain('href="/"');
  });

  test("explains iPhone installation and remembers dismissal", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      });
    });
    await page.goto("/");

    const installCard = page.getByLabel("Install Open Fantasy Baseball");
    await expect(installCard).toBeVisible();
    await expect(installCard).toContainText("Add to Home Screen");
    await installCard.getByRole("button", { name: "Dismiss install suggestion" }).click();
    await expect(installCard).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel("Install Open Fantasy Baseball")).toHaveCount(0);
  });
});
