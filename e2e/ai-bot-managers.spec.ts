import { expect, test } from "@playwright/test";

test("league members can inspect AI opponents and decisions without management controls", async ({ page }) => {
  await page.route("**/api/v1/leagues/*/bot-managers", (route) => route.fulfill({ json: {
    managers: [{ teamId: "bot", name: "Bot: Bleacher Creatures", model: "test-model", strategy: "", enabled: true, allowTrades: false, hasToken: true, tokenExpiresAt: null }],
    decisions: [{ id: "decision", name: "Bot: Bleacher Creatures", model: "test-model", reason: "Keep the injured ace for his return.", status: "completed", kind: "note", created_at: "2026-09-19T12:00:00Z" }],
  } }));
  await page.goto("/team/team-1?tab=league");
  await page.getByRole("button", { name: "View AI managers" }).click();
  await expect(page.getByText("test-model · AI management enabled")).toBeVisible();
  await expect(page.getByText("Keep the injured ace for his return.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save AI manager" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "View AI managers" }).click();
  await expect(page.getByText("test-model · AI management enabled")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("AI manager loading failures are visible and bot MCP rejects anonymous callers", async ({ page, request }) => {
  await page.route("**/api/v1/leagues/*/bot-managers", (route) => route.fulfill({ status: 503, json: { error: "AI managers unavailable" } }));
  await page.goto("/team/team-1?tab=league");
  await page.getByRole("button", { name: "View AI managers" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "AI managers unavailable" })).toBeVisible();
  const response = await request.post("/api/mcp/bot", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect((await response.json()).error.code).toBe(-32001);
});