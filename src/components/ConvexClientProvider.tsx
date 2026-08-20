"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { LocalPlannerAuthProvider } from "@/auth/use-planner-auth";
import { LocalRepositoryProvider } from "@/data/use-repository";

const ConfiguredConvexClientProvider = dynamic(
  () =>
    import("./ConfiguredConvexClientProvider").then(
      (module) => module.ConfiguredConvexClientProvider,
    ),
  { loading: ConfiguredProviderLoading },
);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();

  return convexUrl ? (
    <ConfiguredConvexClientProvider url={convexUrl}>{children}</ConfiguredConvexClientProvider>
  ) : (
    <LocalProviders>{children}</LocalProviders>
  );
}

/** Keeps the viewport stable and announces the configured provider's async startup. */
export function ConfiguredProviderLoading() {
  return (
    <div
      role="status"
      className="flex min-h-screen items-center justify-center bg-content px-6 text-center text-sm text-secondary"
    >
      Connecting to sync…
    </div>
  );
}

function LocalProviders({ children }: { children: ReactNode }) {
  return (
    <LocalPlannerAuthProvider>
      <LocalRepositoryProvider>{children}</LocalRepositoryProvider>
    </LocalPlannerAuthProvider>
  );
}
