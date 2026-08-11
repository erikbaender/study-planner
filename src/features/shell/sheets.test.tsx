import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { plan as makePlan } from "@/test/factories";
import { ConfirmDeleteSheet, NewPlanSheet, SampleDataSheet } from "./sheets";

describe("SampleDataSheet", () => {
  it("offers all datasets and loads the selected one", async () => {
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(
      <SampleDataSheet open onOpenChange={vi.fn()} hasData={false} onLoad={onLoad} />,
    );

    expect(screen.getByRole("radio", { name: /Generated medical semester/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /Lernplan feature showcase/ })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Lernplan \(MHH\)/ }));
    await user.click(screen.getByRole("button", { name: "Load sample" }));

    expect(onLoad).toHaveBeenCalledWith("mhh-lernplan");
  });

  it("makes replacement explicit when the planner already has data", () => {
    render(<SampleDataSheet open onOpenChange={vi.fn()} hasData onLoad={vi.fn()} />);

    expect(screen.getByText(/replaces your current semesters and study history/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace data" })).toBeInTheDocument();
  });
});

describe("semester sheets", () => {
  it("creates a semester with its name", async () => {
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <NewPlanSheet
        open
        onOpenChange={onOpenChange}
        onCreate={onCreate}
      />,
    );

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Summer");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith({ name: "Summer" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses the generic confirmation for deleting a semester", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDeleteSheet
        target={{ kind: "plan", plan: makePlan({ name: "Spring" }) }}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
