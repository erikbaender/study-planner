import { defineConfig } from "vitest/config";

/**
 * Two projects, because the suite has two genuinely different shapes.
 *
 * `domain` is pure — dates, metrics, parsing, and a repository running against
 * `memoryStorage()`. It has no business paying for a DOM, and keeping it in
 * node keeps the fast half of the suite fast.
 *
 * `ui` needs one. Its setup file supplies the browser APIs jsdom omits but
 * Radix's overlays require.
 */
export default defineConfig({
  // Resolves the `@/*` alias from tsconfig.json, so tests import exactly the
  // specifiers the app does.
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "domain",
          environment: "node",
          include: ["src/{domain,data,lib}/**/*.test.ts"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/ui/**/*.test.tsx"],
          setupFiles: ["src/test/setup-dom.ts"],
        },
      },
    ],
  },
});
