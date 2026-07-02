import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

/**
 * The smoke suite runs the app in demo/mock mode: with DATABASE_URL and the
 * Neon Auth variables blanked out, the app serves bundled mock data and a demo
 * admin user, so the tests are hermetic (no Neon dependency) and never hit the
 * sign-in wall. Next.js does not override environment variables that are
 * already set, so these blanks win over .env.local.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: "",
      NEON_AUTH_BASE_URL: "",
      NEON_AUTH_COOKIE_SECRET: "",
      WEB_PUSH_PUBLIC_KEY: "",
      WEB_PUSH_PRIVATE_KEY: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
