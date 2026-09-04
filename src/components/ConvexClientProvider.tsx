"use client";

import type { ReactNode } from "react";
import { ConfiguredConvexClientProvider } from "./ConfiguredConvexClientProvider";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();

  if (!convexUrl) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-content px-6">
        <div role="alert" className="max-w-lg text-center">
          <h1 className="text-title font-semibold text-label">Cloud configuration required</h1>
          <p className="mt-2 text-body text-secondary">
            Study Planner requires authenticated Convex storage. Set NEXT_PUBLIC_CONVEX_URL in the
            browser environment, then restart the application.
          </p>
          <p className="mt-3 text-callout text-tertiary">
            Run <code>pnpm exec convex dev --once</code> for local development setup.
          </p>
        </div>
      </main>
    );
  }

  return (
    <ConfiguredConvexClientProvider url={convexUrl}>{children}</ConfiguredConvexClientProvider>
  );
}
