import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./command-palette";
import type { Command } from "@/features/workspace/commands";

function commandsFor(run: (id: string) => void): Command[] {
  return [
    { id: "view:today", group: "View", title: "Today", run: () => run("view:today") },
    { id: "view:outline", group: "View", title: "Outline", run: () => run("view:outline") },
    { id: "course:bc", group: "Courses", title: "Biochemistry", subtitle: "2 topics", run: () => run("course:bc") },
    { id: "topic:gly", group: "Topics", title: "Glycolysis", subtitle: "Biochemistry", run: () => run("topic:gly") },
  ];
}

/** Owns `open` the way the shell does, so closing on run is observable. */
function Harness({ onRun }: { onRun: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  return <CommandPalette open={open} onOpenChange={setOpen} commands={commandsFor(onRun)} />;
}

function options() {
  return screen.getAllByRole("option");
}

describe("CommandPalette", () => {
  it("opens focused on the field, with the first result highlighted", () => {
    render(<Harness onRun={vi.fn()} />);

    const field = screen.getByRole("combobox");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-autocomplete", "list");
    expect(field).toHaveAttribute("aria-haspopup", "listbox");
    expect(field).toHaveAttribute("aria-activedescendant", options()[0].id);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("keeps focus in the field while the arrows move the highlight", async () => {
    // The whole point of `aria-activedescendant`: moving real focus into the
    // list would stop the user typing after the first arrow key.
    const user = userEvent.setup();
    render(<Harness onRun={vi.fn()} />);

    const field = screen.getByRole("combobox");
    await user.keyboard("{ArrowDown}");

    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-activedescendant", options()[1].id);
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
  });

  it("wraps at both ends", async () => {
    const user = userEvent.setup();
    render(<Harness onRun={vi.fn()} />);

    await user.keyboard("{ArrowUp}");
    expect(options().at(-1)).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("leaves text-editing keys to the combobox", async () => {
    const user = userEvent.setup();
    render(<Harness onRun={vi.fn()} />);

    const field = screen.getByRole("combobox");
    const firstOption = field.getAttribute("aria-activedescendant");
    await user.keyboard("{End}");

    expect(field).toHaveAttribute("aria-activedescendant", firstOption);
  });

  it("does not run a command while an input method is composing text", () => {
    const onRun = vi.fn();
    render(<Harness onRun={onRun} />);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter", isComposing: true });

    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("runs the highlighted command on Enter and closes", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<Harness onRun={onRun} />);

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onRun).toHaveBeenCalledWith("view:outline");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("runs a command on click", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<Harness onRun={onRun} />);

    await user.click(screen.getByRole("option", { name: /Biochemistry/ }));
    expect(onRun).toHaveBeenCalledWith("course:bc");
  });

  it("filters as you type and re-highlights the top result", async () => {
    const user = userEvent.setup();
    render(<Harness onRun={vi.fn()} />);

    await user.type(screen.getByRole("combobox"), "gly");

    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent("Glycolysis");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("withholds topics until something is typed", async () => {
    const user = userEvent.setup();
    render(<Harness onRun={vi.fn()} />);

    expect(screen.queryByRole("option", { name: /Glycolysis/ })).not.toBeInTheDocument();

    await user.type(screen.getByRole("combobox"), "gly");
    expect(screen.getByRole("option", { name: /Glycolysis/ })).toBeInTheDocument();
  });

  it("says so rather than showing an empty list when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness onRun={vi.fn()} />);

    await user.type(screen.getByRole("combobox"), "zzzz");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("listbox", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Nothing matches/);
    // With nothing to point at, the field must not claim an active descendant.
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-activedescendant");
  });

  it("does nothing on Enter when nothing matches", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    render(<Harness onRun={onRun} />);

    await user.type(screen.getByRole("combobox"), "zzzz{Enter}");
    expect(onRun).not.toHaveBeenCalled();
  });

  it("groups the results under headings", () => {
    render(<Harness onRun={vi.fn()} />);
    const view = screen.getByRole("group", { name: "View" });
    expect(within(view).getAllByRole("option")).toHaveLength(2);
  });

  it("forgets the query between openings", async () => {
    // Reopening onto the last search would make ⌘K unpredictable — sometimes a
    // fresh list, sometimes a filtered one, depending on what you did last.
    const user = userEvent.setup();
    const { rerender } = render(
      <CommandPalette open onOpenChange={vi.fn()} commands={commandsFor(vi.fn())} />,
    );
    await user.type(screen.getByRole("combobox"), "gly");

    rerender(
      <CommandPalette open={false} onOpenChange={vi.fn()} commands={commandsFor(vi.fn())} />,
    );
    rerender(<CommandPalette open onOpenChange={vi.fn()} commands={commandsFor(vi.fn())} />);

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(1);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness onRun={vi.fn()} />);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
