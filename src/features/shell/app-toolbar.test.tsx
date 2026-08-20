import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PlannerAuthStatus } from "@/auth/use-planner-auth";
import { AppToolbar } from "./app-toolbar";

function renderToolbar(authStatus: PlannerAuthStatus) {
  const onSignIn = vi.fn();
  const onSignOut = vi.fn();
  render(
    <AppToolbar
      view="today"
      onViewChange={vi.fn()}
      contentId="workspace"
      sidebarOpen
      onToggleSidebar={vi.fn()}
      onOpenPalette={vi.fn()}
      onNewPlan={vi.fn()}
      onNewCourse={vi.fn()}
      onLoadSampleData={vi.fn()}
      onExport={vi.fn()}
      onImport={vi.fn()}
      canExport={false}
      authStatus={authStatus}
      onSignIn={onSignIn}
      onSignOut={onSignOut}
    />,
  );
  return { onSignIn, onSignOut };
}

describe("AppToolbar authentication state", () => {
  it("identifies an unconfigured app as local-only and offers no auth action", () => {
    renderToolbar("local-only");

    expect(screen.getByText("Local only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("keeps sign-in available when Convex is configured but signed out", async () => {
    const user = userEvent.setup();
    const { onSignIn } = renderToolbar("local");

    expect(screen.getByText("This device")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("shows configured authentication loading without enabling sign-in", () => {
    renderToolbar("loading");

    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("offers sign-out for synchronized data", async () => {
    const user = userEvent.setup();
    const { onSignOut } = renderToolbar("synced");

    expect(screen.getByText("Synced")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
