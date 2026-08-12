import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import { useWorkspace } from "@/features/workspace/store";
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
  makeTopic({ name: "Glycolysis", totalUnits: 100, completedUnits: 40 }),
  makeTopic({ name: "Krebs cycle", totalUnits: 50 }),
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
  onAddRow = vi.fn(),
}: {
  selectedId?: string | null;
  onSelect?: (topic: typeof topics[number]) => void;
  onDelete?: (topic: typeof topics[number]) => void;
  onAddRow?: () => void;
} = {}) {
  render(
    <TopicList
      course={course}
      topics={topics}
      today={TODAY}
      selectedId={selectedId}
      onSelect={onSelect}
      onDelete={onDelete}
      onAddRow={onAddRow}
    />,
  );
  return { onSelect, onDelete, onAddRow };
}

describe("TopicList", () => {
  it("selects the topic represented by a row when its select button is clicked", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList();

    await user.click(screen.getByRole("button", { name: "Select Glycolysis" }));

    expect(onSelect).toHaveBeenCalledWith(topics[0]);
  });

  it("selects a topic and deletes it from its context menu", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderList();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Glycolysis") });

    expect(useWorkspace.getState().selection).toEqual({ kind: "topic", id: topics[0].id });
    expect(screen.queryByRole("button", { name: "Delete Glycolysis" })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(topics[0]);
  });

  it("calls onAddRow when the add topic row is clicked", async () => {
    const user = userEvent.setup();
    const { onAddRow } = renderList();

    await user.click(screen.getByRole("button", { name: "Add topic" }));

    expect(onAddRow).toHaveBeenCalledOnce();
  });

  it("marks the selected topic row as pressed so the current selection is visible", () => {
    renderList({ selectedId: topics[1].id });

    expect(screen.getByRole("button", { name: "Select Krebs cycle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Select Glycolysis" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders one row per topic and an add topic row", () => {
    renderList();

    expect(screen.getAllByRole("listitem")).toHaveLength(topics.length + 1);
    expect(screen.getAllByRole("button", { name: /^Select / })).toHaveLength(topics.length);
    expect(screen.getByRole("button", { name: "Add topic" })).toBeInTheDocument();
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
