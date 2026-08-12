import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, snapshot as makeSnapshot, topic as makeTopic } from "@/test/factories";
import { useWorkspace } from "@/features/workspace/store";
import { OutlineView } from "./outline-view";
import { TOPIC_ROW_HEIGHT, TopicList } from "./topic-list";

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
const topics = [
  makeTopic({ name: "Krebs cycle", totalUnits: 50 }),
  makeTopic({ name: "Glycolysis", totalUnits: 100, completedUnits: 40 }),
];
const course = makeCourse({ name: "Biochemistry", topics });

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.getState().select(null);
});

function renderList({
  selectedId = null,
  onSelect = vi.fn(),
  onDelete = vi.fn(),
}: {
  selectedId?: string | null;
  onSelect?: (topic: typeof topics[number]) => void;
  onDelete?: (topic: typeof topics[number]) => void;
} = {}) {
  render(
    <TopicList
      course={course}
      topics={topics}
      today={TODAY}
      selectedId={selectedId}
      onSelect={onSelect}
      onDelete={onDelete}
    />,
  );
  return { onSelect, onDelete };
}

describe("TopicList", () => {
  it("selects the topic represented by a row when its select button is clicked", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList();

    await user.click(screen.getByRole("button", { name: "Select Glycolysis" }));

    expect(onSelect).toHaveBeenCalledWith(topics[1]);
  });

  it("does not select a topic when its context menu opens", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderList();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Glycolysis") });

    expect(useWorkspace.getState().selection).toBeNull();
    expect(screen.getByText("Glycolysis").closest(".topic-completion-row")).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(screen.queryByRole("button", { name: "Delete Glycolysis" })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(topics[1]);
  });

  it("renders course topics alphabetically", () => {
    render(
      <OutlineView
        courses={[course]}
        health={new Map()}
        today={TODAY}
        query=""
        snapshot={makeSnapshot()}
        selectedId={null}
        onSelectTopic={vi.fn()}
        onSelectExam={vi.fn()}
        onDeleteTopic={vi.fn()}
        onDeleteCourse={vi.fn()}
        onEditCourse={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button", { name: /^Select / }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "Select Glycolysis",
      "Select Krebs cycle",
    ]);
  });

  it("marks the selected topic row as pressed so the current selection is visible", () => {
    renderList({ selectedId: topics[0].id });

    expect(screen.getByRole("button", { name: "Select Krebs cycle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Select Glycolysis" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders one row per topic and nothing else", () => {
    // Adding a topic is the section header's button, which opens the form. A
    // second affordance shaped like a row was a different way of adding a
    // different kind of topic — an unnamed one.
    renderList();

    expect(screen.getAllByRole("listitem")).toHaveLength(topics.length);
    expect(screen.getAllByRole("button", { name: /^Select / })).toHaveLength(topics.length);
  });

  it("warns on a topic whose scheduled window has closed with work left", () => {
    const overdue = makeTopic({
      name: "Lipids",
      totalUnits: 20,
      blocks: [
        {
          id: "block_overdue",
          topicId: "topic_overdue",
          startDate: "2026-04-20",
          endDate: "2026-04-25",
          source: "auto" as const,
        },
      ],
    });
    render(
      <TopicList
        course={makeCourse({ topics: [overdue] })}
        topics={[overdue]}
        today={TODAY}
        selectedId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "Lipids has overdue work" })).toBeInTheDocument();
  });

  it("keeps each transitioning slot fixed while the visible row is inset", () => {
    renderList();

    const topicSlot = screen
      .getAllByRole("listitem")
      .find((item) => item.querySelector(".topic-completion-row"));

    expect(topicSlot).toHaveStyle({ height: `${TOPIC_ROW_HEIGHT}px` });
    expect(topicSlot).toHaveClass("p-[3px]");
    expect(topicSlot?.querySelector(".topic-completion-row")).toHaveStyle({ height: "28px" });
  });
});
