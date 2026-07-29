import { defineConfig } from "vitest/config";

/**
 * Node environment, not jsdom: everything under test here is pure — dates,
 * metrics, parsing, and a repository that runs against `memoryStorage()`. The
 * component tests that arrive with phase 2 will need a DOM; adding one now
 * would only slow this suite down.
 */
export default defineConfig({
  // Resolves the `@/*` alias from tsconfig.json, so tests import exactly the
  // specifiers the app does.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
