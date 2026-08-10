"use client";

/**
 * The only bridge between the repository layer and React.
 *
 * `StudyPlannerApp` used to hold two parallel sets of mutations and choose
 * between them at every call site. It now reads one repository out of context
 * and calls it; which implementation is behind the interface is decided once,
 * here, from the auth state.
 */

import { useConvex, useConvexAuth } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createConvexRepository } from "./convex-repository";
import { createLocalRepository } from "./local-repository";
import type { PlannerRepository, RepositoryState } from "./repository";

type ContextValue = {
  repository: PlannerRepository;
  /**
   * Fire-and-forget for a mutation, capturing the failure centrally.
   *
   * Mutations are rejected promises, not thrown exceptions, so an error
   * boundary never sees them. Without one shared place to land, every call site
   * grows its own `.catch`, and the ones that forget fail silently — which is
   * how the old code lost validation errors.
   */
  run: (action: Promise<unknown>) => void;
  mutationError: Error | null;
  clearError: () => void;
};

const RepositoryContext = createContext<ContextValue | null>(null);

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const convex = useConvex();
  const { isAuthenticated } = useConvexAuth();
  const [mutationError, setMutationError] = useState<Error | null>(null);

  const repository = useMemo(
    () => (isAuthenticated ? createConvexRepository(convex) : createLocalRepository()),
    [convex, isAuthenticated],
  );

  const run = useCallback((action: Promise<unknown>) => {
    setMutationError(null);
    void action.catch((cause: unknown) =>
      setMutationError(cause instanceof Error ? cause : new Error(String(cause))),
    );
  }, []);

  const clearError = useCallback(() => setMutationError(null), []);

  const value = useMemo(
    () => ({ repository, run, mutationError, clearError }),
    [repository, run, mutationError, clearError],
  );

  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}

function usePlannerContext(): ContextValue {
  const value = useContext(RepositoryContext);
  if (!value) {
    throw new Error("Planner hooks must be used inside a <RepositoryProvider>");
  }
  return value;
}

export function useRepository(): PlannerRepository {
  return usePlannerContext().repository;
}

/**
 * Mutating a plan does not require subscribing to the plan itself.
 *
 * Views with many repeated controls used to call `usePlannerErrors()` solely
 * to get `run`, which also installed a repository snapshot subscription for
 * every row. Keep the error-aware hook for surfaces that render the error, but
 * let leaf controls obtain the stable runner without becoming subscribers.
 */
export function usePlannerRun(): (action: Promise<unknown>) => void {
  return usePlannerContext().run;
}

const LOADING: RepositoryState = { status: "loading" };

/**
 * Subscribes to the repository.
 *
 * `useSyncExternalStore` compares snapshots by reference and re-renders in a
 * loop if `getSnapshot` returns a fresh object, so the latest state is cached
 * in a ref and handed back unchanged until the repository pushes a new one.
 */
export function usePlannerState(): RepositoryState {
  const repository = useRepository();
  const cache = useRef<{ repository: PlannerRepository; state: RepositoryState } | null>(null);

  const subscribe = useMemo(
    () => (onChange: () => void) =>
      repository.subscribe((state) => {
        cache.current = { repository, state };
        onChange();
      }),
    [repository],
  );

  const getSnapshot = useCallback(
    () => (cache.current?.repository === repository ? cache.current.state : LOADING),
    [repository],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => LOADING);
}

/**
 * The failure to show, if any: a mutation rejection, or the repository itself
 * being unreachable. Derived rather than mirrored into state, so there is no
 * render in which the two disagree.
 */
export function usePlannerErrors() {
  const { run, mutationError, clearError } = usePlannerContext();
  const state = usePlannerState();

  return {
    run,
    error: mutationError ?? (state.status === "error" ? state.error : null),
    /** No-op for a repository-level error: that one is not dismissible. */
    clear: clearError,
  };
}
