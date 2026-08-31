import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { plan as makePlan } from "@/test/factories";
import { ConfirmPlanDeleteSheet, EditPlanSheet, SampleDataSheet } from "./sheets";

describe("SampleDataSheet", () => {
  it("offers all datasets and loads the selected one", async () => {
    const onLoad = vi.fn();
    const user = userEvent.setup();
    render(
      <SampleDataSheet open onOpenChange={vi.fn()} hasData={false} onLoad={onLoad} />,
    );

    expect(screen.getByRole("radio", { name: /Lernplan \(MHH\)/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /Lernplan feature showcase/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Full medical|Compact medical/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /Lernplan feature showcase/ }));
    await user.click(screen.getByRole("button", { name: "Load sample" }));

    expect(onLoad).toHaveBeenCalledWith("mhh-showcase");
  });

  it("makes replacement explicit when the planner already has data", () => {
    render(<SampleDataSheet open onOpenChange={vi.fn()} hasData onLoad={vi.fn()} />);

    expect(screen.getByText(/replaces your current semesters and study history/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace data" })).toBeInTheDocument();
  });
});

describe("semester sheets", () => {
  it("saves edited semester details", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <EditPlanSheet
        plan={makePlan({ name: "Spring" })}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Summer");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Summer" }));
  });

  it("requires confirmation before deleting a semester", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmPlanDeleteSheet
        plan={makePlan({ name: "Spring" })}
        open
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
