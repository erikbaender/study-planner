import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import { TimelineView } from "./timeline-view";

const repository = { createStudyBlock: vi.fn(() => Promise.resolve()) };
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

    await user.click(screen.getByRole("button", { name: "Biochemistry" }));
    const lane = screen.getByTitle("Drag to place a study block for Glycolysis");
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
});
