import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "./store";
import { useWorkspacePersistence, workspacePreferenceKey } from "./persistence";

const deploymentUrl = "https://planner.convex.cloud";

function resetWorkspace() {
  const workspace = useWorkspace.getState();
  workspace.setPlan(null);
  workspace.setView("today");
}

beforeEach(() => {
  window.localStorage.clear();
  resetWorkspace();
});

describe("workspace persistence", () => {
  it("waits for an authenticated ready snapshot before restoring", () => {
    const key = workspacePreferenceKey("student@example.com", deploymentUrl)!;
    window.localStorage.setItem(key, JSON.stringify({ planId: "plan_saved", view: "timeline" }));

    const { rerender } = renderHook(
      ({ ready }) => useWorkspacePersistence({
        accountEmail: "student@example.com",
        deploymentUrl,
        ready,
        planIds: ["plan_saved"],
      }),
      { initialProps: { ready: false } },
    );
    expect(useWorkspace.getState()).toMatchObject({ planId: null, view: "today" });

    rerender({ ready: true });
    expect(useWorkspace.getState()).toMatchObject({ planId: "plan_saved", view: "timeline" });
  });

  it("restores a saved view and semester after reload", () => {
    const key = workspacePreferenceKey("student@example.com", deploymentUrl)!;
    window.localStorage.setItem(key, JSON.stringify({ planId: "plan_second", view: "outline" }));

    renderHook(() => useWorkspacePersistence({
      accountEmail: "student@example.com",
      deploymentUrl,
      ready: true,
      planIds: ["plan_first", "plan_second"],
    }));

    expect(useWorkspace.getState()).toMatchObject({ planId: "plan_second", view: "outline" });
  });

  it("falls back to a current semester when the saved one was deleted", () => {
    const key = workspacePreferenceKey("student@example.com", deploymentUrl)!;
    window.localStorage.setItem(key, JSON.stringify({ planId: "deleted_plan", view: "timeline" }));

    renderHook(() => useWorkspacePersistence({
      accountEmail: "student@example.com",
      deploymentUrl,
      ready: true,
      planIds: ["remaining_plan", "another_plan"],
    }));

    expect(useWorkspace.getState()).toMatchObject({ planId: "remaining_plan", view: "timeline" });
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({
      planId: "remaining_plan",
      view: "timeline",
    });
  });

  it("keeps preferences isolated by account and deployment", () => {
    const firstKey = workspacePreferenceKey("first@example.com", deploymentUrl)!;
    const secondKey = workspacePreferenceKey("second@example.com", deploymentUrl)!;
    const otherDeploymentKey = workspacePreferenceKey("first@example.com", "https://other.convex.cloud")!;
    window.localStorage.setItem(firstKey, JSON.stringify({ planId: "first_plan", view: "timeline" }));
    act(() => {
      useWorkspace.getState().setPlan("first_plan");
      useWorkspace.getState().setView("timeline");
    });

    renderHook(() => useWorkspacePersistence({
      accountEmail: "second@example.com",
      deploymentUrl,
      ready: true,
      planIds: ["second_plan"],
    }));

    expect(useWorkspace.getState()).toMatchObject({ planId: "second_plan", view: "today" });
    expect(window.localStorage.getItem(firstKey)).toBe(
      JSON.stringify({ planId: "first_plan", view: "timeline" }),
    );
    expect(window.localStorage.getItem(secondKey)).toBe(
      JSON.stringify({ planId: "second_plan", view: "today" }),
    );
    expect(otherDeploymentKey).not.toBe(firstKey);
    expect(workspacePreferenceKey(null, deploymentUrl)).toBeNull();
  });

  it("writes only selected semester and view changes", () => {
    const key = workspacePreferenceKey("student@example.com", deploymentUrl)!;
    renderHook(() => useWorkspacePersistence({
      accountEmail: "student@example.com",
      deploymentUrl,
      ready: true,
      planIds: ["plan_first", "plan_second"],
    }));

    act(() => {
      useWorkspace.getState().setView("timeline");
      useWorkspace.getState().setPlan("plan_second");
    });

    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual({
      planId: "plan_second",
      view: "timeline",
    });
  });
});
