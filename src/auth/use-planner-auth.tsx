"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthProviderId } from "./providers";

export type PlannerAuthStatus = "local-only" | "loading" | "local" | "synced";

export type PlannerAuth = {
  status: PlannerAuthStatus;
  signIn: (provider?: AuthProviderId) => void | Promise<unknown>;
  signOut: () => void | Promise<unknown>;
};

const PlannerAuthContext = createContext<PlannerAuth | null>(null);

const LOCAL_ONLY_AUTH: PlannerAuth = {
  status: "local-only",
  // App features always receive one provider-neutral shape. The local-only
  // toolbar exposes neither action, so these safe no-ops are only a defensive
  // boundary for callers outside that UI.
  signIn: () => undefined,
  signOut: () => undefined,
};

/** Provides the provider-neutral auth contract to application features. */
export function PlannerAuthProvider({
  value,
  children,
}: {
  value: PlannerAuth;
  children: ReactNode;
}) {
  return <PlannerAuthContext.Provider value={value}>{children}</PlannerAuthContext.Provider>;
}

/** Auth context for a build with no Convex deployment configured. */
export function LocalPlannerAuthProvider({ children }: { children: ReactNode }) {
  return <PlannerAuthProvider value={LOCAL_ONLY_AUTH}>{children}</PlannerAuthProvider>;
}

/** The provider-neutral auth surface used by application features. */
export function usePlannerAuth(): PlannerAuth {
  const auth = useContext(PlannerAuthContext);
  if (!auth) throw new Error("usePlannerAuth must be used inside a planner auth provider");
  return auth;
}
