import { defineConfig } from "vitest/config";

/**
 * Three projects, because the suite has three genuinely different shapes.
 *
 * `domain` is pure — dates, metrics, parsing, and a repository running against
 * `memoryStorage()`. It has no business paying for a DOM, and keeping it in
 * node keeps the fast half of the suite fast.
 *
 * `ui` and the React repository bridge need one. Their setup file supplies the
 * browser APIs jsdom omits but Radix's overlays require.
 *
 * `features` is the same environment as `ui` but a different layer: primitives
 * versus the screens assembled from them. Kept apart so that "did I break a
 * button or did I break the shell" is answerable from the run output alone.
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
          include: ["src/{domain,data,lib}/**/*.test.ts", "convex/**/*.test.ts"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/ui/**/*.test.tsx", "src/data/**/*.test.tsx"],
          setupFiles: ["src/test/setup-dom.ts"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "features",
          environment: "jsdom",
          include: ["src/features/**/*.test.{ts,tsx}"],
          setupFiles: ["src/test/setup-dom.ts"],
        },
      },
    ],
  },
});
