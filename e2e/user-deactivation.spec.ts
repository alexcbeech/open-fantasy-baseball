import { expect, test } from "@playwright/test";
import type { AdminUser } from "../lib/data/admin-user-schema";

test("admin confirms deactivation, sees persistence, handles stale state, and reactivates", async ({ page }) => {
  const user: AdminUser = { id: "00000000-0000-4000-8000-000000000002", email: "manager@ofb.test", displayName: "Test Manager", deactivatedAt: null, deactivatedBy: null, reason: null, revision: 0, authSyncPending: false };
  let fail = false;
  let writes = 0;
  await page.route("**/api/v1/admin/users**", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { users: [user], currentUserId: "admin", configured: true } });
    writes++;
    if (fail) return route.fulfill({ status: 409, json: { error: "This account changed. Reload users before continuing." } });
    const command = route.request().postDataJSON(); user.revision++;
    user.deactivatedAt = command.action === "deactivate" ? "2026-09-15T01:00:00Z" : null;
    user.reason = command.reason; user.deactivatedBy = "admin@ofb.test";
    return route.fulfill({ json: { authSyncPending: false } });
  });
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Users", exact: true });
  await panel.getByRole("button", { name: "Deactivate", exact: true }).click();
  expect(writes).toBe(0);
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toBe(0);
  await panel.getByRole("button", { name: "Deactivate", exact: true }).click();
  await panel.getByLabel("Reason (optional)").fill("Manager requested a break");
  await panel.getByRole("button", { name: "Confirm account change" }).click();
  await expect(panel.getByRole("status")).toContainText("Account deactivated");
  await page.reload();
  await expect(panel.getByText("Deactivated", { exact: true })).toBeVisible();
  await expect(panel.getByText("Manager requested a break", { exact: false })).toBeVisible();
  fail = true;
  await panel.getByRole("button", { name: "Reactivate", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm account change" }).click();
  await expect(panel.getByRole("alert")).toContainText("account changed");
  fail = false;
  await panel.getByRole("button", { name: "Reactivate", exact: true }).click();
  await panel.getByRole("button", { name: "Confirm account change" }).click();
  await expect(panel.getByRole("status")).toContainText("fresh sign-in");
  await page.reload();
  await expect(panel.getByText("Active", { exact: true })).toBeVisible();
});

test("admin cannot deactivate self and can retry a pending provider block", async ({ page }) => {
  let pending = true;
  await page.route("**/api/v1/admin/users**", async route => {
    if (route.request().method() === "POST") { pending = false; return route.fulfill({ json: { authSyncPending: false } }); }
    const base = { reason: null, revision: 0, deactivatedBy: null };
    return route.fulfill({ json: { currentUserId: "admin", configured: true, users: [
      { ...base, id: "admin", email: "admin@ofb.test", displayName: "Administrator", deactivatedAt: null, authSyncPending: false },
      { ...base, id: "other", email: "manager@ofb.test", displayName: "Manager", deactivatedAt: "2026-09-15T01:00:00Z", authSyncPending: pending },
    ] } });
  });
  await page.goto("/admin");
  const panel = page.getByRole("region", { name: "Users", exact: true });
  await expect(panel.getByRole("button", { name: "Deactivate", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Retry authentication sync" }).click();
  await panel.getByRole("button", { name: "Confirm account change" }).click();
  await expect(panel.getByRole("status")).toContainText("Authentication synchronized");
  await expect(panel.getByRole("button", { name: "Retry authentication sync" })).toHaveCount(0);
});
