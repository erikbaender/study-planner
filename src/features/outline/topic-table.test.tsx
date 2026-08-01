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

  it("asks for a new row on ⌘⏎ and not on plain Enter", async () => {
    const onAddRow = vi.fn();
    const user = userEvent.setup();
    renderTable(onAddRow);

    const name = screen.getByLabelText("Name of Glycolysis");
    await user.click(name);
    await user.keyboard("{Enter}");
    expect(onAddRow).not.toHaveBeenCalled();

    await user.keyboard("{Meta>}{Enter}{/Meta}");
    // The new row lands in the section the cursor was in, not at the bottom.
    expect(onAddRow).toHaveBeenCalledWith("Block 1");
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
    expect(within(row).getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });
});
