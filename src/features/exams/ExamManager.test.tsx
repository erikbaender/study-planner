import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { course, exam } from "@/test/factories";
import { ExamManager } from "./ExamManager";

const TODAY = "2026-07-30";
const final = exam({
  id: "exam_final",
  name: "Final",
  kind: "exam",
  startDate: "2026-08-20",
  endDate: "2026-08-25",
  status: "provisional",
  notes: "Room to be confirmed",
});
const biochemistry = course({
  id: "course_bio",
  name: "Biochemistry",
  exams: [final],
});

function renderManager() {
  const props = {
    course: biochemistry,
    today: TODAY,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<ExamManager {...props} />);
  return props;
}

describe("ExamManager", () => {
  it("creates a typed provisional window with notes", async () => {
    const user = userEvent.setup();
    const props = renderManager();

    await user.click(screen.getByRole("button", { name: "Add exam" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add exam or deadline" }));
    await user.type(dialog.getByRole("textbox", { name: "Name" }), "Oral defense");
    await user.selectOptions(dialog.getByRole("combobox", { name: "Type" }), "presentation");
    await user.selectOptions(dialog.getByRole("combobox", { name: "Certainty" }), "provisional");
    fireEvent.change(dialog.getByLabelText("Window starts"), {
      target: { value: "2026-09-10" },
    });
    fireEvent.change(dialog.getByLabelText("Window ends"), {
      target: { value: "2026-09-14" },
    });
    await user.type(dialog.getByRole("textbox", { name: "Notes" }), "Panel pending");
    await user.click(dialog.getByRole("button", { name: "Add exam" }));

    expect(props.onCreate).toHaveBeenCalledWith({
      name: "Oral defense",
      kind: "presentation",
      startDate: "2026-09-10",
      endDate: "2026-09-14",
      status: "provisional",
      notes: "Panel pending",
    });
  });

  it("edits every field and clears a provisional window when confirmed", async () => {
    const user = userEvent.setup();
    const props = renderManager();

    await user.click(screen.getByRole("button", { name: "Edit Final" }));
    const dialog = within(screen.getByRole("dialog", { name: "Edit exam or deadline" }));
    await user.selectOptions(dialog.getByRole("combobox", { name: "Certainty" }), "confirmed");
    expect(dialog.queryByLabelText("Window ends")).not.toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Save changes" }));

    expect(props.onUpdate).toHaveBeenCalledWith("exam_final", {
      name: "Final",
      kind: "exam",
      startDate: "2026-08-20",
      endDate: undefined,
      status: "confirmed",
      notes: "Room to be confirmed",
    });
  });

  it("exposes deletion as a named action", async () => {
    const user = userEvent.setup();
    const props = renderManager();

    await user.click(screen.getByRole("button", { name: "Delete Final" }));
    expect(props.onDelete).toHaveBeenCalledWith("exam_final");
  });
});
