import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { TextField } from "./field";
import { ContextMenu, DropdownMenu, Popover, Sheet } from "./overlays";

describe("Popover", () => {
  it("stays closed until its trigger is used", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Appearance</Button>}>
        <p>Accent colour</p>
      </Popover>,
    );

    expect(screen.queryByText("Accent colour")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    expect(await screen.findByText("Accent colour")).toBeInTheDocument();
  });

  it("tells assistive technology the trigger expands something", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Appearance</Button>}>
        <p>Accent colour</p>
      </Popover>,
    );

    const trigger = screen.getByRole("button", { name: "Appearance" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<Button>Appearance</Button>}>
        <p>Accent colour</p>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await screen.findByText("Accent colour");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Accent colour")).not.toBeInTheDocument());
  });
});

describe("Sheet", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <Sheet
        open={open}
        onOpenChange={setOpen}
        trigger={<Button>New course</Button>}
        title="New course"
        description="Courses group the topics you work through."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="accent">Create</Button>
          </>
        }
      >
        <TextField label="Name" />
      </Sheet>
    );
  }

  it("is a dialog named and described by its header", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "New course" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("New course");
    expect(dialog).toHaveAccessibleDescription("Courses group the topics you work through.");
  });

  it("moves focus into itself, and back to the trigger on close", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "New course" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("has no close button, because the footer already offers a way out", async () => {
    // A ✕ in the corner is a second control for what Cancel already does, and a
    // macOS sheet has none — it is attached to the document rather than being a
    // window of its own.
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "New course" }));
    await screen.findByRole("dialog");

    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});

describe("DropdownMenu", () => {
  const items = [
    { label: "Rename", onSelect: vi.fn() },
    { type: "separator" as const },
    { label: "Delete", onSelect: vi.fn(), danger: true },
  ];

  it("opens as a menu and runs the chosen item", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DropdownMenu
        trigger={<Button>Actions</Button>}
        items={[{ label: "Rename", onSelect }, ...items.slice(1)]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));

    expect(onSelect).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("is operable from the keyboard alone", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<DropdownMenu trigger={<Button>Actions</Button>} items={[{ label: "Rename", onSelect }]} />);

    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("renders a checkbox item with its state", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        trigger={<Button>View</Button>}
        items={[{ type: "checkbox", label: "Show completed", checked: true, onSelect: vi.fn() }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "Show completed" })).toBeChecked();
  });

  it("does not fire a disabled item", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DropdownMenu
        trigger={<Button>Actions</Button>}
        items={[{ label: "Delete", onSelect, disabled: true }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ContextMenu", () => {
  it("opens on right-click over its trigger", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <ContextMenu items={[{ label: "Delete course", onSelect }]}>
        <div>Biochemistry</div>
      </ContextMenu>,
    );

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Biochemistry") });
    await user.click(await screen.findByRole("menuitem", { name: "Delete course" }));

    expect(onSelect).toHaveBeenCalledOnce();
  });
});
