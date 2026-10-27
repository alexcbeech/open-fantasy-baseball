import { expect, test } from "@playwright/test";

test("API proxy rejects cross-origin mutations before auth, parsing, or side effects", async ({ request }) => {
  for (const path of ["/api/v1/leagues", "/api/v1/admin/users", "/api/v1/profile/push", "/api/mcp/bot"]) {
    const response = await request.post(path, { headers: { Origin: "https://foreign.example" }, data: {} });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toBe("Send changes from this app's page.");
  }
  const sameOrigin = await request.post("/api/v1/leagues", {
    headers: { Origin: "http://localhost:3100" }, data: {},
  });
  expect(sameOrigin.status()).toBe(400);
  expect((await sameOrigin.json()).error).toBe("Invalid league settings");
});
