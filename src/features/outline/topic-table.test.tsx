import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import { TopicTable } from "./topic-table";

const repository = {
  updateTopic: vi.fn(() => Promise.resolve()),
  logStudy: vi.fn(() => Promise.resolve()),
};
vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerRun: () => vi.fn(),
  usePlannerErrors: () => ({ run: vi.fn(), error: null, clear: () => {} }),
}));

const TODAY = "2026-05-01";

beforeEach(() => vi.clearAllMocks());

const glycolysis = makeTopic({
  name: "Glycolysis",
  section: "Block 1",
  totalUnits: 100,
  completedUnits: 40,
});
const krebs = makeTopic({ name: "Krebs cycle", section: "Block 2", totalUnits: 50 });
const course = makeCourse({ name: "Biochemistry", topics: [glycolysis, krebs] });

function renderTable(onAddRow = vi.fn()) {
  render(
    <TopicTable
      course={course}
      topics={course.topics}
      today={TODAY}
      selectedId={null}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onAddRow={onAddRow}
    />,
  );
  return onAddRow;
}

describe("TopicTable", () => {
  it("groups rows under their section", () => {
    renderTable();
    expect(screen.getByRole("heading", { name: "Block 1" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Block 2" })).toBeInTheDocument();
  });

  it("commits a size change on blur and leaves progress alone", async () => {
    // The rule the whole outline is built around: `updateTopic` resends the
    // whole topic, so `completedUnits` must go back exactly as it came. Writing
    // it here would move the number while leaving velocity nothing to measure.
    const user = userEvent.setup();
    renderTable();

    const total = screen.getByLabelText("Total slides in Glycolysis");
    await user.clear(total);
    await user.type(total, "120");
    await user.tab();

    expect(repository.updateTopic).toHaveBeenCalledWith(
      glycolysis.id,
      expect.objectContaining({ totalUnits: 120, completedUnits: 40 }),
    );
    expect(repository.logStudy).not.toHaveBeenCalled();
  });

  it("reverts a cell on Escape without writing", async () => {
    const user = userEvent.setup();
    renderTable();

    const name = screen.getByLabelText("Name of Glycolysis");
    await user.type(name, " II{Escape}");

    expect(name).toHaveValue("Glycolysis");
    expect(repository.updateTopic).not.toHaveBeenCalled();
  });

  it("does not add a row from the keyboard: Enter only commits the cell", async () => {
    const onAddRow = vi.fn();
    const user = userEvent.setup();
    renderTable(onAddRow);

    const name = screen.getByLabelText("Name of Glycolysis");
    await user.click(name);
    await user.keyboard("{Enter}");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    // Adding a row is the context menu's "New topic below" and the button under
    // the table; the app has no keyboard shortcuts.
    expect(onAddRow).not.toHaveBeenCalled();
  });

  it("offers no slider for a topic whose size nobody has stated", () => {
    const unsized = makeTopic({ name: "Reading list", totalUnits: 0 });
    render(
      <TopicTable
        course={makeCourse({ topics: [unsized] })}
        topics={[unsized]}
        today={TODAY}
        selectedId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onAddRow={vi.fn()}
      />,
    );

    const row = screen.getByLabelText("Name of Reading list").closest("li")!;
    expect(within(row).queryByRole("slider")).not.toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Mark Reading list as done" })).toBeDisabled();
    expect(within(row).getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  it("marks a topic done instantly and clears it when unchecked", async () => {
    const user = userEvent.setup();
    renderTable();

    const checkbox = screen.getByRole("checkbox", { name: "Mark Glycolysis as done" });
    await user.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(repository.logStudy).toHaveBeenLastCalledWith({
      topicId: glycolysis.id,
      date: TODAY,
      units: 60,
    });

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(checkbox.closest("li")).toHaveAttribute("data-completion-trigger", "checkbox");
    expect(checkbox.closest("li")).toHaveAttribute("data-completion-direction", "off");
    expect(repository.logStudy).toHaveBeenLastCalledWith({
      topicId: glycolysis.id,
      date: TODAY,
      units: -100,
    });
  });

  it("checks the completion control when progress reaches full", () => {
    const finished = makeTopic({ name: "Finished", totalUnits: 50, completedUnits: 50 });
    render(
      <TopicTable
        course={makeCourse({ topics: [finished] })}
        topics={[finished]}
        today={TODAY}
        selectedId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onAddRow={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Mark Finished as done" })).toBeChecked();
  });

  it("keeps the readout, working slider, and checkbox in trailing order", () => {
    renderTable();

    const row = screen.getByLabelText("Name of Glycolysis").closest("li")!;
    const readout = within(row).getByText("40 / 100 slides");
    const slider = within(row).getByRole("slider", { name: "Glycolysis progress" });
    const checkbox = within(row).getByRole("checkbox", { name: "Mark Glycolysis as done" });

    expect(readout.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slider.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row).toHaveStyle({ "--topic-completion-color": "#8169d1" });
  });

  it("only marks a row for animation when completion is checked interactively", async () => {
    const finished = makeTopic({ name: "Already finished", totalUnits: 50, completedUnits: 50 });
    const { rerender } = render(
      <TopicTable
        course={makeCourse({ topics: [finished] })}
        topics={[finished]}
        today={TODAY}
        selectedId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onAddRow={vi.fn()}
      />,
    );
    const loadedRow = screen.getByLabelText("Name of Already finished").closest("li")!;
    expect(loadedRow).not.toHaveAttribute("data-completion-animating");

    rerender(
      <TopicTable
        course={course}
        topics={course.topics}
        today={TODAY}
        selectedId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onAddRow={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const checkbox = screen.getByRole("checkbox", { name: "Mark Glycolysis as done" });
    const row = screen.getByLabelText("Name of Glycolysis").closest("li")!;
    await user.click(checkbox);
    expect(row).toHaveAttribute("data-completion-trigger", "checkbox");
    expect(row).toHaveAttribute("data-completion-direction", "on");
    expect(row).toHaveAttribute("data-completion-animating", "true");

    await new Promise((resolve) => window.setTimeout(resolve, 310));
    expect(row).not.toHaveAttribute("data-completion-animating");
  });

  it("marks a row for animation when its slider reaches full", async () => {
    const user = userEvent.setup();
    renderTable();
    const row = screen.getByLabelText("Name of Glycolysis").closest("li")!;
    const slider = within(row).getByRole("slider", { name: "Glycolysis progress" });

    await user.click(slider);
    await user.keyboard("{End}");

    expect(row).toHaveAttribute("data-completion-trigger", "slider");
    expect(row).toHaveAttribute("data-completion-animating", "true");
    expect(within(row).getByRole("checkbox", { name: "Mark Glycolysis as done" })).toBeChecked();
  });

  it("reverses the completion animation when the slider leaves full", async () => {
    const finished = makeTopic({ name: "Finished", totalUnits: 50, completedUnits: 50 });
    const user = userEvent.setup();
    render(
      <TopicTable
        course={makeCourse({ topics: [finished] })}
        topics={[finished]}
        today={TODAY}
        selectedId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onAddRow={vi.fn()}
      />,
    );
    const row = screen.getByLabelText("Name of Finished").closest("li")!;
    const slider = within(row).getByRole("slider", { name: "Finished progress" });

    await user.click(slider);
    await user.keyboard("{ArrowLeft}");

    expect(row).toHaveAttribute("data-completion-trigger", "slider");
    expect(row).toHaveAttribute("data-completion-direction", "off");
    expect(within(row).getByRole("checkbox", { name: "Mark Finished as done" })).not.toBeChecked();
  });
});
