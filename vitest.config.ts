import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Unit tests only; the Playwright *.spec.ts files under e2e/ run separately.
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "e2e", ".next"],
  },
});
