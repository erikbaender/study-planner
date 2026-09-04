"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useMemo, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
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
  const account = useQuery(api.account.current, isAuthenticated ? {} : "skip");

  const status: PlannerAuthStatus = isLoading
    ? "loading"
    : isAuthenticated
      ? "authenticated"
      : "signed-out";
  const value = useMemo<PlannerAuth>(
    () => ({
      status,
      account: account ?? null,
      signIn: (provider = DEFAULT_AUTH_PROVIDER) => signIn(provider),
      signOut,
    }),
    [account, signIn, signOut, status],
  );

  return <PlannerAuthProvider value={value}>{children}</PlannerAuthProvider>;
}
