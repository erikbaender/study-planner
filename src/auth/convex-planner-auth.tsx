"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useMemo, type ReactNode } from "react";
import {
  PlannerAuthProvider,
  type PlannerAuth,
  type PlannerAuthStatus,
} from "./use-planner-auth";
import { DEFAULT_AUTH_PROVIDER } from "./providers";

/** Adapts Convex Auth to the provider-neutral contract used by app features. */
export function ConvexPlannerAuthProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();

  const status: PlannerAuthStatus = isLoading
    ? "loading"
    : isAuthenticated
      ? "synced"
      : "local";
  const value = useMemo<PlannerAuth>(
    () => ({
      status,
      signIn: (provider = DEFAULT_AUTH_PROVIDER) => signIn(provider),
      signOut,
    }),
    [signIn, signOut, status],
  );

  return <PlannerAuthProvider value={value}>{children}</PlannerAuthProvider>;
}
