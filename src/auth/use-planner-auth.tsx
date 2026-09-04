"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AuthProviderId } from "./providers";

export type PlannerAuthStatus = "loading" | "signed-out" | "authenticated";

export type PlannerAccount = {
  name: string | null;
  email: string | null;
  image: string | null;
};

export type PlannerAuth = {
  status: PlannerAuthStatus;
  account: PlannerAccount | null;
  signIn: (provider?: AuthProviderId) => void | Promise<unknown>;
  signOut: () => void | Promise<unknown>;
};

const PlannerAuthContext = createContext<PlannerAuth | null>(null);

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

/** The provider-neutral auth surface used by application features. */
export function usePlannerAuth(): PlannerAuth {
  const auth = useContext(PlannerAuthContext);
  if (!auth) throw new Error("usePlannerAuth must be used inside a planner auth provider");
  return auth;
}
