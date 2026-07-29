import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button, FileButton, IconButton } from "./button";
import { SegmentedControl } from "./segmented-control";
import { Checkbox, Stepper, Switch } from "./toggles";

describe("Button", () => {
  it("does not submit the form it happens to sit in", async () => {
    // The default `type` of a bare <button> is "submit", which turns every
    // incidental button inside a form into an accidental submit.
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Button>Cancel</Button>
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still submits when asked to", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Save</Button>
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("hides decorative icons from the accessible name", () => {
    render(<Button leadingIcon={<svg data-testid="icon" />}>Export</Button>);
    expect(screen.getByRole("button")).toHaveAccessibleName("Export");
  });

  it("renders as its child when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/docs">Docs</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Docs" })).toBeInTheDocument();
  });
});

describe("IconButton", () => {
  it("names itself, since it has no text to be named by", () => {
    render(<IconButton label="Delete topic" icon={<svg />} />);
    expect(screen.getByRole("button")).toHaveAccessibleName("Delete topic");
  });
});

describe("FileButton", () => {
  it("keeps the real file input, so it is reachable by keyboard", async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    render(<FileButton label="Import" accept="application/json" onFile={onFile} />);

    const input = screen.getByLabelText("Import");
    await user.upload(input, new File(["{}"], "plan.json", { type: "application/json" }));

    expect(onFile).toHaveBeenCalledOnce();
    expect(onFile.mock.calls[0][0].name).toBe("plan.json");
  });

  it("clears itself so the same file can be picked twice", async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    render(<FileButton label="Import" onFile={onFile} />);

    const input = screen.getByLabelText<HTMLInputElement>("Import");
    await user.upload(input, new File(["{}"], "plan.json"));
    expect(input.value).toBe("");
  });
});

function Segments() {
  const [value, setValue] = useState("week");
  return (
    <>
      <SegmentedControl
        label="Zoom level"
        value={value}
        onValueChange={setValue}
        segments={[
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
        ]}
      />
      <output>{value}</output>
    </>
  );
}

describe("SegmentedControl", () => {
  it("exposes itself as a radio group, not a row of buttons", () => {
    render(<Segments />);
    expect(screen.getByRole("radiogroup", { name: "Zoom level" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Week" })).toBeChecked();
  });

  it("changes the value on click", async () => {
    const user = userEvent.setup();
    render(<Segments />);

    await user.click(screen.getByRole("radio", { name: "Month" }));
    expect(screen.getByRole("status")).toHaveTextContent("month");
  });

  it("has no empty state — re-pressing the selected segment keeps it", async () => {
    const user = userEvent.setup();
    render(<Segments />);

    // Radix reports "" when a pressed item is pressed again. A zoom level of
    // nothing is not a state this control has.
    await user.click(screen.getByRole("radio", { name: "Week" }));
    expect(screen.getByRole("status")).toHaveTextContent("week");
    expect(screen.getByRole("radio", { name: "Week" })).toBeChecked();
  });

  it("moves between segments with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Segments />);

    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("month");
  });
});

describe("Checkbox", () => {
  it("associates its label, so the text is a click target too", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} label="Blackout day" />);

    await user.click(screen.getByText("Blackout day"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("reports a partially-complete group as mixed", () => {
    render(<Checkbox checked="indeterminate" onCheckedChange={vi.fn()} label="Biochemistry" />);
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed");
  });

  it("resolves indeterminate to checked rather than passing the string on", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox checked="indeterminate" onCheckedChange={onCheckedChange} label="All" />);

    await user.click(screen.getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("Switch", () => {
  it("is a switch, not a checkbox", async () => {
    const onCheckedChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Sync" />);

    const control = screen.getByRole("switch", { name: "Sync" });
    await user.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

function StepperHarness({ initial = 0, ...props }: { initial?: number } & Record<string, unknown>) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <Stepper label="Units studied" value={value} onValueChange={setValue} {...props} />
      <output>{value}</output>
    </>
  );
}

describe("Stepper", () => {
  it("nudges by the step size, not by one", async () => {
    const user = userEvent.setup();
    render(<StepperHarness step={5} />);

    await user.click(screen.getByRole("button", { name: "Increase Units studied" }));
    expect(screen.getByRole("status")).toHaveTextContent("5");
  });

  it("stops at the bounds", async () => {
    const user = userEvent.setup();
    render(<StepperHarness initial={0} min={0} max={10} step={5} />);

    expect(screen.getByRole("button", { name: "Decrease Units studied" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Increase Units studied" }));
    await user.click(screen.getByRole("button", { name: "Increase Units studied" }));
    expect(screen.getByRole("status")).toHaveTextContent("10");
    expect(screen.getByRole("button", { name: "Increase Units studied" })).toBeDisabled();
  });

  it("does not clamp while the field is being typed into", async () => {
    const user = userEvent.setup();
    render(<StepperHarness initial={0} min={0} max={120} />);

    const field = screen.getByRole("spinbutton", { name: "Units studied" });
    await user.clear(field);
    await user.type(field, "1");

    // Clamping mid-type would rewrite the "1" on the way to "120" — the reason
    // this control clamps on blur instead.
    expect(screen.getByRole("status")).toHaveTextContent("1");
  });

  it("clamps on blur", async () => {
    const user = userEvent.setup();
    render(<StepperHarness initial={0} min={0} max={120} />);

    const field = screen.getByRole("spinbutton", { name: "Units studied" });
    await user.clear(field);
    await user.type(field, "500");
    await user.tab();

    expect(screen.getByRole("status")).toHaveTextContent("120");
  });

  it("allows a negative minimum, for correcting an over-log", async () => {
    const user = userEvent.setup();
    render(<StepperHarness initial={0} min={-30} step={5} />);

    await user.click(screen.getByRole("button", { name: "Decrease Units studied" }));
    expect(screen.getByRole("status")).toHaveTextContent("-5");
  });
});
