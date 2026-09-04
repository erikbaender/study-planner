"use client";

import { useConvex } from "convex/react";
import { useMemo, type ReactNode } from "react";
import { createConvexRepository } from "./convex-repository";
import { RepositoryStoreProvider } from "./use-repository";

/** Mounts the sole planner repository after the authentication gate opens. */
export function ConvexRepositoryProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const repository = useMemo(() => createConvexRepository(convex), [convex]);

  return <RepositoryStoreProvider repository={repository}>{children}</RepositoryStoreProvider>;
}
