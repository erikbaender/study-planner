"use client";

import { useEffect, useRef } from "react";
import { useWorkspace, VIEWS, type ViewId } from "./store";

type WorkspacePreference = {
  planId: string | null;
  view: ViewId;
};

const STORAGE_PREFIX = "study-planner:workspace:v1";

/** Returns no key when the identity or deployment is unknown. */
export function workspacePreferenceKey(
  accountEmail: string | null | undefined,
  deploymentUrl: string | null | undefined,
): string | null {
  const email = accountEmail?.trim().toLowerCase();
  const deployment = deploymentUrl?.trim().replace(/\/+$/, "");
  if (!email || !deployment) return null;
  return `${STORAGE_PREFIX}:${encodeURIComponent(deployment)}:${encodeURIComponent(email)}`;
}

/** Validates saved values against the current account snapshot. */
export function parseWorkspacePreference(
  raw: string | null,
  planIds: readonly string[],
): WorkspacePreference | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const saved = value as Record<string, unknown>;
    const planId =
      typeof saved.planId === "string" && planIds.includes(saved.planId)
        ? saved.planId
        : planIds[0] ?? null;
    const view = isViewId(saved.view) ? saved.view : "today";
    return { planId, view };
  } catch {
    return null;
  }
}

/**
 * Restores only after auth and the account's first snapshot are ready. Storage
 * is keyed by deployment and normalized email, so switching either identity
 * starts from that account's own last semester and view.
 */
export function useWorkspacePersistence({
  accountEmail,
  deploymentUrl,
  ready,
  planIds,
}: {
  accountEmail: string | null | undefined;
  deploymentUrl: string | null | undefined;
  ready: boolean;
  planIds: readonly string[];
}) {
  const key = workspacePreferenceKey(accountEmail, deploymentUrl);
  const identityRef = useRef<string | null>(null);
  const planIdsKey = JSON.stringify(planIds);

  useEffect(() => {
    if (!ready || !key) {
      identityRef.current = null;
      return;
    }

    const ids = JSON.parse(planIdsKey) as string[];
    if (identityRef.current !== key) {
      let saved: WorkspacePreference | null = null;
      try {
        saved = parseWorkspacePreference(window.localStorage.getItem(key), ids);
      } catch {
        // Storage can be disabled by browser settings. The planner still works
        // with its in-memory workspace when that happens.
      }

      const workspace = useWorkspace.getState();
      const initialPlanId = saved?.planId ?? ids[0] ?? null;
      if (workspace.planId !== initialPlanId) workspace.setPlan(initialPlanId);
      workspace.setView(saved?.view ?? "today");
      identityRef.current = key;
    }

    const current = useWorkspace.getState();
    if (current.planId === null || !ids.includes(current.planId)) {
      current.setPlan(ids[0] ?? null);
    }

    const persist = (planId: string | null, view: ViewId) => {
      try {
        window.localStorage.setItem(key, JSON.stringify({ planId, view }));
      } catch {
        // Persistence is a convenience, not a condition for using the planner.
      }
    };

    const currentWorkspace = useWorkspace.getState();
    persist(currentWorkspace.planId, currentWorkspace.view);
    return useWorkspace.subscribe((next, previous) => {
      if (next.planId !== previous.planId || next.view !== previous.view) {
        persist(next.planId, next.view);
      }
    });
  }, [key, planIdsKey, ready]);
}

function isViewId(value: unknown): value is ViewId {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value);
}
