import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { topic } from "@/test/factories";
import { StudyHistory } from "./StudyHistory";

const TODAY = "2026-07-30";
const glycolysis = topic({
  id: "topic_glycolysis",
  name: "Glycolysis",
  unit: "pages",
  totalUnits: 80,
  completedUnits: 20,
});

describe("StudyHistory", () => {
  it("shows only the selected topic's newest history", () => {
    render(
      <StudyHistory
        topic={glycolysis}
        today={TODAY}
        entries={[
          {
            id: "log_old",
            topicId: glycolysis.id,
            date: "2026-07-28",
            units: 4,
            minutes: 25,
            note: "Recall drill",
          },
          {
            id: "log_other",
            topicId: "topic_other",
            date: TODAY,
            units: 100,
            note: "Private other topic",
          },
        ]}
        onLogStudy={vi.fn()}
      />,
    );

    expect(screen.getByText(/Recall drill/)).toBeInTheDocument();
    expect(screen.getByText(/\+4 pages/)).toBeInTheDocument();
    expect(screen.queryByText("Private other topic")).not.toBeInTheDocument();
  });

  it("records dated units, duration, and a note through one log input", async () => {
    const user = userEvent.setup();
    const onLogStudy = vi.fn();
    render(
      <StudyHistory
        topic={glycolysis}
        today={TODAY}
        entries={[]}
        onLogStudy={onLogStudy}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Log progress" }));
    const dialog = within(screen.getByRole("dialog", { name: "Log progress for Glycolysis" }));
    fireEvent.change(dialog.getByLabelText("Date"), { target: { value: "2026-07-29" } });
    await user.type(dialog.getByRole("spinbutton", { name: "Pages" }), "12");
    await user.type(dialog.getByRole("spinbutton", { name: "Minutes" }), "35");
    await user.type(dialog.getByRole("textbox", { name: "Note" }), "Practice questions");
    await user.click(dialog.getByRole("button", { name: "Log progress" }));

    expect(onLogStudy).toHaveBeenCalledWith({
      topicId: glycolysis.id,
      date: "2026-07-29",
      units: 12,
      minutes: 35,
      note: "Practice questions",
    });
  });

  it("rejects zero progress instead of writing an empty history event", async () => {
    const user = userEvent.setup();
    render(
      <StudyHistory
        topic={glycolysis}
        today={TODAY}
        entries={[]}
        onLogStudy={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Log progress" }));
    const dialog = within(screen.getByRole("dialog", { name: "Log progress for Glycolysis" }));
    await user.type(dialog.getByRole("spinbutton", { name: "Pages" }), "0");

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a number greater than zero.");
    expect(dialog.getByRole("button", { name: "Log progress" })).toBeDisabled();
  });
});
