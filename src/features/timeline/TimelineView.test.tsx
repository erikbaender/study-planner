import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course, exam, plan, topic } from "@/test/factories";
import { TimelineView } from "./TimelineView";

const repository = vi.hoisted(() => ({
  updateStudyBlock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerErrors: () => ({
    run: (action: Promise<unknown>) => void action,
    error: null,
    clear: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({
    count,
    estimateSize,
    scrollMargin = 0,
  }: {
    count: number;
    estimateSize: () => number;
    scrollMargin?: number;
  }) => {
    const size = estimateSize();
    return {
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          key: index,
          index,
          start: scrollMargin + index * size,
          end: scrollMargin + (index + 1) * size,
          size,
          lane: 0,
        })),
      getTotalSize: () => count * size,
      measure: vi.fn(),
      scrollToIndex: vi.fn(),
    };
  },
}));

const cellBiology = topic({
  id: "topic_1",
  name: "Cell biology",
  totalUnits: 20,
  completedUnits: 10,
  status: "active",
  dependencyIds: [],
  blocks: [
    {
      id: "block_1",
      topicId: "topic_1",
      startDate: "2026-08-03",
      endDate: "2026-08-05",
      plannedUnits: 8,
      source: "auto",
    },
  ],
});
const metabolism = topic({
  id: "topic_2",
  name: "Metabolism",
  totalUnits: 10,
  completedUnits: 0,
  dependencyIds: ["topic_1"],
  blocks: [
    {
      id: "block_2",
      topicId: "topic_2",
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      source: "manual",
    },
  ],
});
const biochemistry = course({
  id: "course_1",
  name: "Biochemistry",
  topics: [cellBiology, metabolism],
  exams: [exam({ id: "exam_1", name: "Final", startDate: "2026-08-20" })],
});
const semester = plan({
  name: "Summer semester",
  startDate: "2026-07-20",
  endDate: "2026-09-01",
  courses: [biochemistry],
});

function renderTimeline() {
  const onSelectTopic = vi.fn();
  const result = render(
    <TimelineView
      plan={semester}
      today="2026-07-30"
      onCreate={vi.fn()}
      onSelectTopic={onSelectTopic}
    />,
  );
  return { ...result, onSelectTopic };
}

describe("TimelineView", () => {
  beforeEach(() => repository.updateStudyBlock.mockClear());

  it("renders virtualized course lanes, progress bars, markers, and zoom", async () => {
    const user = userEvent.setup();
    renderTimeline();

    expect(
      screen.getByRole("grid", { name: "Summer semester timeline" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse Biochemistry" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("gridcell", { name: /Cell biology.*50% complete/ }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Final, 2026-08-20")).toBeInTheDocument();
    expect(screen.getByLabelText("Today, 2026-07-30")).toBeInTheDocument();

    const firstBlock = screen.getByRole("gridcell", { name: /Cell biology/ });
    const secondBlock = screen.getByRole("gridcell", { name: /Metabolism/ });
    await user.click(firstBlock);
    await user.keyboard("{Escape}");
    fireEvent.click(secondBlock, { shiftKey: true });
    expect(firstBlock).toHaveAttribute("aria-selected", "true");
    expect(secondBlock).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Month" }));
    expect(screen.getByRole("radio", { name: "Month" })).toHaveAttribute(
      "data-state",
      "on",
    );

    await user.click(screen.getByRole("button", { name: "Collapse Biochemistry" }));
    expect(
      screen.queryByRole("gridcell", { name: /Cell biology/ }),
    ).not.toBeInTheDocument();
  });

  it("opens an anchored editor and supports keyboard move and resize", async () => {
    const user = userEvent.setup();
    const { onSelectTopic } = renderTimeline();
    const block = screen.getByRole("gridcell", { name: /Cell biology/ });

    block.focus();
    await user.keyboard("{ArrowRight}");
    expect(repository.updateStudyBlock).toHaveBeenCalledWith("block_1", {
      startDate: "2026-08-10",
      endDate: "2026-08-12",
    });

    repository.updateStudyBlock.mockClear();
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(repository.updateStudyBlock).toHaveBeenCalledWith("block_1", {
      startDate: "2026-08-03",
      endDate: "2026-08-03",
      plannedUnits: 8,
    });

    await user.click(block);
    expect(onSelectTopic).toHaveBeenCalledWith("topic_1", "course_1");
    expect(screen.getByLabelText("Starts")).toHaveValue("2026-08-03");
    expect(screen.getByLabelText("Ends")).toHaveValue("2026-08-05");
  });

  it("does not turn sub-threshold pointer movement into a drag", () => {
    renderTimeline();
    const block = screen.getByRole("gridcell", { name: /Cell biology/ });

    fireEvent.pointerDown(block, { pointerId: 1, button: 0, clientX: 100 });
    fireEvent.pointerMove(block, { pointerId: 1, clientX: 103 });
    fireEvent.pointerUp(block, { pointerId: 1, clientX: 103 });
    expect(repository.updateStudyBlock).not.toHaveBeenCalled();

    fireEvent.pointerDown(block, { pointerId: 2, button: 0, clientX: 100 });
    fireEvent.pointerMove(block, { pointerId: 2, clientX: 140 });
    fireEvent.pointerUp(block, { pointerId: 2, clientX: 140 });
    expect(repository.updateStudyBlock).toHaveBeenCalledWith("block_1", {
      startDate: "2026-08-10",
      endDate: "2026-08-12",
    });
  });

  it("keeps keyboard focus when a moved block rerenders", () => {
    const { rerender } = renderTimeline();
    const block = screen.getByRole("gridcell", { name: /Cell biology/ });
    block.focus();

    const movedTopic = {
      ...cellBiology,
      blocks: [
        {
          ...cellBiology.blocks[0],
          startDate: "2026-08-10" as const,
          endDate: "2026-08-12" as const,
        },
      ],
    };
    const movedCourse = {
      ...biochemistry,
      topics: [movedTopic, metabolism],
    };
    rerender(
      <TimelineView
        plan={{ ...semester, courses: [movedCourse] }}
        today="2026-07-30"
        onCreate={vi.fn()}
        onSelectTopic={vi.fn()}
      />,
    );

    expect(document.activeElement).toBe(
      screen.getByRole("gridcell", { name: /Cell biology.*2026-08-10/ }),
    );
  });
});
