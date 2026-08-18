import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectField, TextArea, TextField } from "./field";

describe("Field wiring", () => {
  it("labels the control, so it is not addressed by placeholder alone", () => {
    // The old implementation shipped inputs whose only label was a placeholder,
    // which disappears the moment anything is typed.
    render(<TextField label="Course name" placeholder="e.g. Biochemistry" />);
    expect(screen.getByRole("textbox", { name: "Course name" })).toBeInTheDocument();
  });

  it("keeps the label for screen readers when it is hidden visually", () => {
    render(<TextField label="Search" hideLabel />);
    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
  });

  it("describes the control with its hint", () => {
    render(<TextField label="Total units" hint="Slides, pages, or minutes." />);
    expect(screen.getByRole("textbox")).toHaveAccessibleDescription("Slides, pages, or minutes.");
  });

  it("marks an errored control invalid and announces the message", () => {
    render(<TextField label="Exam date" error="Pick a date in the future." />);

    const input = screen.getByRole("textbox");
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription("Pick a date in the future.");
    // role="alert" so a message that appears on submit is not silent.
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a date in the future.");
  });

  it("shows the error instead of the hint rather than both", () => {
    render(<TextField label="Total units" hint="Slides or pages." error="Must be a number." />);
    expect(screen.queryByText("Slides or pages.")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Must be a number.");
  });

  it("is not invalid when there is no error", () => {
    render(<TextField label="Course name" />);
    expect(screen.getByRole("textbox")).not.toBeInvalid();
  });

  it("gives each field its own id, so two on a page do not collide", () => {
    render(
      <>
        <TextField label="First" />
        <TextField label="Second" />
      </>,
    );
    const [first, second] = screen.getAllByRole("textbox");
    expect(first.id).not.toBe(second.id);
  });

  it("applies the same wiring to a text area", () => {
    render(<TextArea label="Outline" hint="One topic per line." />);
    const area = screen.getByRole("textbox", { name: "Outline" });
    expect(area.tagName).toBe("TEXTAREA");
    expect(area).toHaveAccessibleDescription("One topic per line.");
  });

  it("applies the same wiring to a select", () => {
    render(<SelectField label="Semester" defaultValue="ws" options={[
      { value: "ws", label: "Winter" },
      { value: "ss", label: "Summer" },
    ]} />);
    expect(screen.getByRole("combobox", { name: "Semester" })).toHaveTextContent("Winter");
  });

  it("opens a custom menu and reports the selected value", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <SelectField
        label="Semester"
        value="ws"
        onValueChange={onValueChange}
        options={[
          { value: "ws", label: "Winter" },
          { value: "ss", label: "Summer" },
        ]}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Semester" }));
    expect(screen.getByRole("option", { name: "Summer" }).closest("[data-keeps-selection]"))
      .toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Summer" }));
    expect(onValueChange).toHaveBeenCalledWith("ss");
  });
});
