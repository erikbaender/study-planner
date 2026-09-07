"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { api } from "../../convex/_generated/api";
import {
  PlannerAuthProvider,
  type PlannerAuth,
  type PlannerAuthStatus,
} from "./use-planner-auth";
import { DEFAULT_AUTH_PROVIDER } from "./providers";
import { useAccountSessions } from "./account-sessions";

/** Adapts Convex Auth to the provider-neutral contract used by app features. */
export function ConvexPlannerAuthProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const account = useQuery(api.account.current, isAuthenticated ? {} : "skip");
  const {
    accounts,
    registerActiveAccount,
    removeActiveAccount,
    switchAccount,
    openAddAccount,
  } = useAccountSessions();

  const status: PlannerAuthStatus = isLoading
    ? "loading"
    : isAuthenticated
      ? "authenticated"
      : "signed-out";
  useEffect(() => {
    if (status === "authenticated" && account) registerActiveAccount(account);
  }, [account, registerActiveAccount, status]);

  const signOutCurrent = useCallback(async () => {
    await signOut();
    removeActiveAccount();
  }, [removeActiveAccount, signOut]);

  const value = useMemo<PlannerAuth>(
    () => ({
      status,
      account: account ?? null,
      signIn: (provider = DEFAULT_AUTH_PROVIDER, options = {}) => signIn(provider, {
        ...options,
        redirectTo: options.redirectTo ?? window.location.pathname + window.location.search,
      }),
      signOut: signOutCurrent,
      accounts,
      switchAccount,
      addAccount: openAddAccount,
    }),
    [account, accounts, openAddAccount, signIn, signOutCurrent, status, switchAccount],
  );

  return <PlannerAuthProvider value={value}>{children}</PlannerAuthProvider>;
}
