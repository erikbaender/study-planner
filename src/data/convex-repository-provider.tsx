"use client";

import { useConvex, useConvexAuth } from "convex/react";
import { useMemo, type ReactNode } from "react";
import { createConvexRepository } from "./convex-repository";
import { createLocalRepository } from "./local-repository";
import { RepositoryStoreProvider } from "./use-repository";

/** Selects local or synchronized storage inside an existing Convex provider. */
export function ConvexRepositoryProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const localRepository = useMemo(() => createLocalRepository(), []);
  const convexRepository = useMemo(() => createConvexRepository(convex), [convex]);
  const repository = isAuthenticated ? convexRepository : localRepository;

  return (
    <RepositoryStoreProvider repository={repository} suspended={isLoading}>
      {children}
    </RepositoryStoreProvider>
  );
}
