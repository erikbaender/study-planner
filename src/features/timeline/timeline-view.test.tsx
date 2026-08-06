import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import type { StudyBlockInput } from "@/data/repository";
import { TimelineView } from "./timeline-view";

const repository = {
  createStudyBlock: vi.fn<(input: StudyBlockInput) => Promise<void>>(() => Promise.resolve()),
};
const run = vi.fn((promise: Promise<unknown>) => promise);

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerErrors: () => ({ run, error: null, clear: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());

describe("TimelineView", () => {
  it("shows unscheduled topics and creates a block by dragging their lane", async () => {
    const topic = makeTopic({ name: "Glycolysis", blocks: [] });
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });
    const user = userEvent.setup();
    render(
      <TimelineView
        courses={[course]}
        health={new Map()}
        today="2026-05-01"
        selectedId={null}
        onSelectTopic={vi.fn()}
        onGoToOutline={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Edit" }));
    await user.click(screen.getAllByRole("button", { name: "Biochemistry" })[0]);
    const lane = screen.getAllByTitle("Drag to place a study block for Glycolysis")[0];
    vi.spyOn(lane, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 1000, bottom: 24, width: 1000, height: 24, x: 0, y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(lane, { button: 0, clientX: 140 });
    fireEvent.pointerMove(window, { clientX: 168 });
    fireEvent.pointerUp(window);

    expect(repository.createStudyBlock).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: topic.id, source: "manual" }),
    );
    const input = repository.createStudyBlock.mock.calls[0][0];
    expect(input.endDate >= input.startDate).toBe(true);
  });

  it("does not create a block from a click that never became a drag", async () => {
    const topic = makeTopic({ name: "Glycolysis", blocks: [] });
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });
    const user = userEvent.setup();
    render(
      <TimelineView
        courses={[course]}
        health={new Map()}
        today="2026-05-01"
        selectedId={null}
        onSelectTopic={vi.fn()}
        onGoToOutline={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Edit" }));
    await user.click(screen.getAllByRole("button", { name: "Biochemistry" })[0]);
    const lane = screen.getAllByTitle("Drag to place a study block for Glycolysis")[0];

    // A pointer that steadied itself by two pixels is a click, and a click on
    // empty canvas means nothing — it used to silently commit a one-day block.
    fireEvent.pointerDown(lane, { button: 0, clientX: 140 });
    fireEvent.pointerMove(window, { clientX: 142 });
    fireEvent.pointerUp(window);

    expect(repository.createStudyBlock).not.toHaveBeenCalled();
  });

  it("tracks the visible dates without re-rendering the timeline tree", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        {
          id: "block_1",
          topicId: "topic_1",
          startDate: "2026-05-10",
          endDate: "2026-05-12",
          source: "auto",
        },
      ],
    });
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });
    const health = new Map();
    const healthLookup = vi.spyOn(health, "get");
    const { container } = render(
      <TimelineView
        courses={[course]}
        health={health}
        today="2026-05-01"
        selectedId={null}
        onSelectTopic={vi.fn()}
        onGoToOutline={vi.fn()}
      />,
    );
    const scroller = container.querySelector(".overflow-auto");
    expect(scroller).toBeInstanceOf(HTMLDivElement);
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 280 });
    healthLookup.mockClear();

    (scroller as HTMLDivElement).scrollLeft += 14;
    fireEvent.scroll(scroller!);

    // Course health is read by the parent lane tree. A lookup here means a
    // scroll notification escaped the marker subscription and reconciled the
    // entire chart again.
    expect(healthLookup).not.toHaveBeenCalled();
  });
});
