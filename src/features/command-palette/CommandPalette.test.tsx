import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";

function Harness({
  commands,
  initialQuery = "",
}: {
  commands: PaletteCommand[];
  initialQuery?: string;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(initialQuery);
  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      commands={commands}
    />
  );
}

describe("CommandPalette", () => {
  it("filters commands by label, detail, and keywords", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        commands={[
          {
            id: "biochem",
            label: "Biochemistry",
            detail: "Course",
            category: "Navigation",
            keywords: ["metabolism"],
            run: vi.fn(),
          },
          {
            id: "timeline",
            label: "Show Timeline",
            category: "View",
            run: vi.fn(),
          },
        ]}
      />,
    );

    const search = screen.getByRole("combobox", { name: "Search commands" });
    await user.type(search, "metabolism");

    expect(screen.getByRole("option", { name: /Biochemistry/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Timeline/ })).not.toBeInTheDocument();
  });

  it("runs the active command with Enter and closes", async () => {
    const run = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        commands={[
          { id: "today", label: "Show Today", category: "View", run },
        ]}
      />,
    );

    await user.keyboard("{Enter}");

    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cycles through results with arrow keys", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        commands={[
          { id: "today", label: "Show Today", category: "View", run: first },
          { id: "outline", label: "Show Outline", category: "View", run: second },
        ]}
      />,
    );

    await user.keyboard("{ArrowDown}{Enter}");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
