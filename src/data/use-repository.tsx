"use client";

/**
 * The only bridge between the repository layer and React.
 *
 * `StudyPlannerApp` used to hold two parallel sets of mutations and choose
 * between them at every call site. It now reads one repository out of context
 * and calls it. The hosting provider supplies the authenticated Convex
 * implementation while this module stays independent of its transport.
 */

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
import type { PlannerRepository, RepositoryState } from "./repository";

type RepositoryActions = {
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
};

type RepositoryErrorState = {
  mutationError: Error | null;
  clearError: () => void;
};

const RepositoryContext = createContext<RepositoryActions | null>(null);
const RepositoryStateContext = createContext<RepositoryState | null>(null);
const RepositoryErrorContext = createContext<RepositoryErrorState | null>(null);

const LOADING: RepositoryState = { status: "loading" };

/**
 * Owns the one subscription to a repository and distributes its latest state.
 * Kept separate from auth so the lifecycle can be tested with a deterministic
 * repository. Its host mounts it only after authentication succeeds.
 */
export function RepositoryStoreProvider({
  repository,
  children,
}: {
  repository: PlannerRepository;
  children: ReactNode;
}) {
  const [failure, setFailure] = useState<{
    repository: PlannerRepository;
    error: Error;
  } | null>(null);
  const repositoryState = useRepositoryState(repository);
  const mutationError = failure?.repository === repository ? failure.error : null;

  const run = useCallback(
    (action: Promise<unknown>) => {
      setFailure(null);
      void action.catch((cause: unknown) =>
        setFailure({
          repository,
          error: cause instanceof Error ? cause : new Error(String(cause)),
        }),
      );
    },
    [repository],
  );

  const clearError = useCallback(() => setFailure(null), []);

  const actions = useMemo(() => ({ repository, run }), [repository, run]);
  const errors = useMemo(
    () => ({ mutationError, clearError }),
    [mutationError, clearError],
  );

  return (
    <RepositoryContext.Provider value={actions}>
      <RepositoryErrorContext.Provider value={errors}>
        <RepositoryStateContext.Provider value={repositoryState}>
          {children}
        </RepositoryStateContext.Provider>
      </RepositoryErrorContext.Provider>
    </RepositoryContext.Provider>
  );
}

function usePlannerContext(): RepositoryActions {
  const value = useContext(RepositoryContext);
  if (!value) {
    throw new Error("Planner hooks must be used inside a repository provider");
  }
  return value;
}

export function useRepository(): PlannerRepository {
  const { repository } = usePlannerContext();
  const state = useContext(RepositoryStateContext);
  return useMemo(
    () => state?.status === "ready" ? repository.atSnapshot?.(state.snapshot) ?? repository : repository,
    [repository, state],
  );
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

/**
 * Subscribes to a repository once for the provider above it.
 *
 * `useSyncExternalStore` compares snapshots by reference and re-renders in a
 * loop if `getSnapshot` returns a fresh object, so the latest state is cached
 * in a ref and handed back unchanged until the repository pushes a new one.
 */
function useRepositoryState(repository: PlannerRepository): RepositoryState {
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

/** Reads the provider-owned snapshot without creating another subscription. */
export function usePlannerState(): RepositoryState {
  const state = useContext(RepositoryStateContext);
  if (!state) {
    throw new Error("Planner hooks must be used inside a repository provider");
  }
  return state;
}

/**
 * The failure to show, if any: a mutation rejection, or the repository itself
 * being unreachable. Derived rather than mirrored into state, so there is no
 * render in which the two disagree.
 */
export function usePlannerErrors() {
  const { run } = usePlannerContext();
  const errors = useContext(RepositoryErrorContext);
  if (!errors) {
    throw new Error("Planner hooks must be used inside a repository provider");
  }
  const state = usePlannerState();

  return {
    run,
    error: errors.mutationError ?? (state.status === "error" ? state.error : null),
    /** No-op for a repository-level error: that one is not dismissible. */
    clear: errors.clearError,
  };
}
