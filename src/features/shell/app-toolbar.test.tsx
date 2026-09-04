import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppToolbar } from "./app-toolbar";

function renderToolbar() {
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
      account={{ name: "Ada Lovelace", email: "ada@example.com", image: null }}
      onSignOut={onSignOut}
    />,
  );
  return onSignOut;
}

describe("AppToolbar account action", () => {
  it("describes the account store without optional-sync language", async () => {
    const user = userEvent.setup();
    const onSignOut = renderToolbar();

    expect(screen.getByRole("button", { name: "Ada Lovelace" })).toHaveAttribute(
      "title",
      "ada@example.com",
    );
    expect(screen.queryByText("Synced")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ada Lovelace" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
