"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";
import { ConvexPlannerAuthProvider } from "@/auth/convex-planner-auth";
import { ConvexRepositoryProvider } from "@/data/convex-repository-provider";

/** The complete optional sync stack, isolated in its own client chunk. */
export function ConfiguredConvexClientProvider({
  url,
  children,
}: {
  url: string;
  children: ReactNode;
}) {
  const convex = useMemo(() => new ConvexReactClient(url), [url]);

  return (
    <ConvexAuthProvider client={convex}>
      <ConvexPlannerAuthProvider>
        <ConvexRepositoryProvider>{children}</ConvexRepositoryProvider>
      </ConvexPlannerAuthProvider>
    </ConvexAuthProvider>
  );
}
