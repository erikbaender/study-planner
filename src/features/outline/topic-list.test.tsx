import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import { TopicList } from "./topic-list";

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

beforeEach(() => vi.clearAllMocks());

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

  it("deletes the topic represented by a row when its delete button is clicked", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderList();

    await user.click(screen.getByRole("button", { name: "Delete Glycolysis" }));

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
});
