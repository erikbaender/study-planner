"use client";

import type { ReactNode } from "react";
import { ConfiguredConvexClientProvider } from "./ConfiguredConvexClientProvider";

type PublicCloudConfiguration = {
  convexUrl?: string;
  convexSiteUrl?: string;
};

export function missingCloudConfiguration({
  convexUrl,
  convexSiteUrl,
}: PublicCloudConfiguration): string[] {
  const entries: Array<[string, string | undefined]> = [
    ["NEXT_PUBLIC_CONVEX_URL", convexUrl],
    ["NEXT_PUBLIC_CONVEX_SITE_URL", convexSiteUrl],
  ];
  return entries.filter((entry) => !entry[1]?.trim()).map(([name]) => name);
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.trim();
  const missing = missingCloudConfiguration({ convexUrl, convexSiteUrl });

  if (!convexUrl || missing.length > 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-content px-6">
        <div role="alert" className="max-w-lg text-center">
          <h1 className="text-title font-semibold text-label">Cloud configuration required</h1>
          <p className="mt-2 text-body text-secondary">
            Study Planner requires authenticated Convex storage. Set {missing.join(" and ")} in
            the browser environment, then restart the application.
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
