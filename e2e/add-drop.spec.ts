import { expect, test } from "@playwright/test";

for (const action of ["add", "claim"] as const) {
  test(`full roster ${action} reviews both players before submitting`, async ({ page }) => {
    await page.route("**/api/v1/players/*?teamId=*", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.player.management = { ...data.player.management, canAdd: action === "add", canClaim: action === "claim", needsDropToAdd: true };
      data.player.dropCandidates = [
        { id: "drop-1", name: "First Teammate", positions: ["OF"] },
        { id: "drop-2", name: "Second Teammate", positions: ["SP"] },
      ];
      if (action === "claim") data.player.waiver = { mode: "faab", faabRemaining: 100, until: "2026-09-15T12:00:00Z" };
      await route.fulfill({ json: data });
    });
    const submissions: unknown[] = [];
    await page.route("**/api/v1/teams/*/players/*/actions", async (route) => {
      submissions.push(route.request().postDataJSON());
      await route.fulfill({ status: 409, json: { error: "Test transaction was not executed." } });
    });
    await page.goto("/team/team-1?tab=players");
    await page.getByRole("button", { name: /View Julio Rodriguez details/ }).click();
    const detail = page.getByRole("dialog", { name: "Player detail" });
    await detail.getByRole("button", { name: action === "add" ? "Add" : "Claim", exact: true }).click();
    await expect(detail.getByRole("heading", { name: "Select a Player to Drop", exact: true })).toBeVisible();
    const review = detail.getByRole("button", { name: "Confirm", exact: true });
    await expect(review).toBeDisabled();
    await expect(detail.locator("select")).toHaveCount(0);
    if (action === "claim") await detail.getByRole("spinbutton").fill("12");
    await detail.getByRole("radio", { name: /First Teammate/ }).check();
    await review.click();
    const summary = detail.getByRole("region", { name: "Transaction summary" });
    await expect(summary).toContainText("Julio Rodriguez");
    await expect(summary).toContainText("First Teammate");
    expect(submissions).toHaveLength(0);
    await expect(detail.getByRole("button", { name: "Change drop player" })).toHaveCount(0);
    await expect(detail).not.toContainText("They'll fill an open eligible lineup slot");
    await detail.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(submissions).toHaveLength(0);
    await detail.getByRole("button", { name: action === "add" ? "Add" : "Claim", exact: true }).click();
    await expect(review).toBeDisabled();
    await detail.getByRole("radio", { name: /Second Teammate/ }).check();
    await expect(detail.getByRole("radio", { name: /First Teammate/ })).not.toBeChecked();
    await review.click();
    await expect(summary).toContainText("Second Teammate");
    if (action === "claim") await expect(summary).toContainText("unless this waiver claim succeeds");
    await detail.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0]).toEqual({ action, dropPlayerId: "drop-2", ...(action === "claim" ? { bid: 12 } : {}) });
  });
}
