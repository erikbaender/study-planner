import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import type { StudyBlockInput } from "@/data/repository";
import { TimelineView } from "./timeline-view";

const repository = {
  createStudyBlock: vi.fn<(input: StudyBlockInput) => Promise<void>>(() => Promise.resolve()),
  updateStudyBlock: vi.fn<(id: string, input: Partial<StudyBlockInput>) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  deleteStudyBlock: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
};
const run = vi.fn((promise: Promise<unknown>) => promise);

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerRun: () => run,
  usePlannerErrors: () => ({ run, error: null, clear: vi.fn() }),
}));

beforeEach(async () => {
  vi.clearAllMocks();
  // A completed drag leaves one click-swallowing listener behind, cleared on a
  // zero timeout (see `swallowNextClick`). Nothing in a browser can click in
  // that window; a synchronous test can, and would then be swallowed.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/** jsdom lays nothing out, and the rubber band asks the browser where things are. */
function placeAt(element: Element, left: number, top: number, width = 60, height = 16) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
}

function chart(topics: ReturnType<typeof makeTopic>[], onSelectTopic = vi.fn()) {
  const course = makeCourse({ name: "Biochemistry", topics });
  render(
    <TimelineView
      courses={[course]}
      health={new Map()}
      today="2026-05-01"
      selectedId={null}
      onSelectTopic={onSelectTopic}
      onGoToOutline={vi.fn()}
    />,
  );
  return { course, onSelectTopic };
}

/** The first of the two bars drawn for a block — the combined lane's copy. */
function bar(dates: RegExp) {
  return screen.getAllByRole("button", { name: dates })[0];
}

function stubAnimationFrames() {
  let nextId = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    void callback;
    return ++nextId;
  });
  const cancel = vi.fn();
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  return { request, cancel };
}

describe("TimelineView", () => {
  it("selects a bar with the left button, and points the inspector at its topic", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    const { onSelectTopic } = chart([topic]);

    const target = bar(/2026-05-04 to 2026-05-08/);
    fireEvent.pointerDown(target, { button: 0, clientX: 100 });
    fireEvent.pointerUp(window, { button: 0, clientX: 100 });

    expect(onSelectTopic).toHaveBeenCalledWith(expect.anything(), topic);
    expect(onSelectTopic).toHaveBeenCalledOnce();
    expect(target).toHaveAttribute("data-selection", "primary");
    // A press that never travelled is a selection, not an edit.
    expect(repository.updateStudyBlock).not.toHaveBeenCalled();
  });

  it("deselects a bar when it is clicked again", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    chart([topic]);

    const target = bar(/2026-05-04 to 2026-05-08/);
    fireEvent.pointerDown(target, { button: 0, clientX: 100 });
    fireEvent.pointerUp(window, { button: 0, clientX: 100 });
    expect(target).toHaveAttribute("data-selection", "primary");

    fireEvent.pointerDown(target, { button: 0, clientX: 100 });
    fireEvent.pointerUp(window, { button: 0, clientX: 100 });
    expect(target).not.toHaveAttribute("data-selection");
  });

  it("reuses the same readout for hover and manipulation", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    chart([topic]);

    const target = bar(/2026-05-04 to 2026-05-08/);
    fireEvent.pointerEnter(target);
    const readout = document.querySelector<HTMLElement>(".timeline-readout")!;
    expect(document.querySelectorAll(".timeline-readout")).toHaveLength(1);
    expect(readout).toHaveAttribute("data-mode", "hover");
    expect(readout).toHaveTextContent("Glycolysis");

    fireEvent.pointerDown(target, { button: 0, pointerId: 41, clientX: 100 });
    expect(document.querySelectorAll(".timeline-readout")).toHaveLength(1);
    expect(readout).toHaveAttribute("data-mode", "manipulation");
    expect(readout).toHaveAttribute("data-visible", "false");

    fireEvent.pointerCancel(window, { pointerId: 41 });
  });

  it("drags every selected bar by the same number of days", () => {
    const first = makeTopic({
      id: "topic_1",
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    const second = makeTopic({
      id: "topic_2",
      name: "Krebs cycle",
      blocks: [
        { id: "block_2", topicId: "topic_2", startDate: "2026-05-18", endDate: "2026-05-20", source: "auto" },
      ],
    });
    chart([first, second]);

    const one = bar(/2026-05-04 to 2026-05-08/);
    fireEvent.pointerDown(one, { button: 0, clientX: 100 });
    fireEvent.pointerUp(window, { button: 0, clientX: 100 });

    // Shift extends the selection, exactly as it does in Blender.
    const two = bar(/2026-05-18 to 2026-05-20/);
    fireEvent.pointerDown(two, { button: 0, clientX: 300, shiftKey: true });
    fireEvent.pointerUp(window, { button: 0, clientX: 300, shiftKey: true });
    expect(one).toHaveAttribute("data-selection", "secondary");
    expect(two).toHaveAttribute("data-selection", "primary");

    // A week at Week zoom is 98px.
    fireEvent.pointerDown(two, { button: 0, clientX: 300 });
    fireEvent.pointerMove(window, { clientX: 398 });
    fireEvent.pointerUp(window, { button: 0, clientX: 398 });

    expect(repository.updateStudyBlock).toHaveBeenCalledWith(
      "block_1",
      expect.objectContaining({ startDate: "2026-05-11", endDate: "2026-05-15" }),
    );
    expect(repository.updateStudyBlock).toHaveBeenCalledWith(
      "block_2",
      expect.objectContaining({ startDate: "2026-05-25", endDate: "2026-05-27" }),
    );
  });

  it("replaces the selection on the press, so a drag moves only the bar under the hand", () => {
    const first = makeTopic({
      id: "topic_1",
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    const second = makeTopic({
      id: "topic_2",
      name: "Krebs cycle",
      blocks: [
        { id: "block_2", topicId: "topic_2", startDate: "2026-05-18", endDate: "2026-05-20", source: "auto" },
      ],
    });
    chart([first, second]);

    const one = bar(/2026-05-04 to 2026-05-08/);
    fireEvent.pointerDown(one, { button: 0, clientX: 100 });
    fireEvent.pointerUp(window, { button: 0, clientX: 100 });
    expect(one).toHaveAttribute("data-selection", "primary");

    // Pressing an unselected bar without a modifier selects it alone, before
    // anything moves, so the bar left behind must not travel with the drag.
    const two = bar(/2026-05-18 to 2026-05-20/);
    fireEvent.pointerDown(two, { button: 0, clientX: 300 });
    expect(two).toHaveAttribute("data-selection", "primary");
    expect(one).not.toHaveAttribute("data-selection");

    fireEvent.pointerMove(window, { clientX: 398 });
    fireEvent.pointerUp(window, { button: 0, clientX: 398 });

    expect(repository.updateStudyBlock).toHaveBeenCalledTimes(1);
    expect(repository.updateStudyBlock).toHaveBeenCalledWith(
      "block_2",
      expect.objectContaining({ startDate: "2026-05-25", endDate: "2026-05-27" }),
    );
  });

  it("cancels a bar drag without leaving a drag listener or changing the bar", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    chart([topic]);

    const target = bar(/2026-05-04 to 2026-05-08/);
    const scroller = document.querySelector<HTMLElement>(".timeline-scrollport")!;
    fireEvent.pointerDown(target, { button: 0, pointerId: 41, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 41, clientX: 200 });
    expect(scroller).toHaveAttribute("data-timeline-dragging", "true");

    fireEvent.pointerCancel(window, { pointerId: 41 });
    expect(scroller).not.toHaveAttribute("data-timeline-dragging");
    expect(scroller).not.toHaveAttribute("data-timeline-resizing");
    expect(target).not.toHaveAttribute("data-selection");

    fireEvent.pointerMove(window, { pointerId: 41, clientX: 400 });
    expect(target).toHaveAttribute("aria-label", expect.stringContaining("2026-05-04 to 2026-05-08"));
    expect(repository.updateStudyBlock).not.toHaveBeenCalled();
  });

  it("commits the release position when drag frames were coalesced", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    chart([topic]);
    const target = bar(/2026-05-04 to 2026-05-08/);
    const frames = stubAnimationFrames();

    fireEvent.pointerDown(target, { button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 200 });
    fireEvent.pointerMove(window, { clientX: 300 });

    // The queued draft has not painted yet, so the bar still describes its
    // committed span while the pointer is between frames.
    expect(target).toHaveAttribute("aria-label", expect.stringContaining("2026-05-04 to 2026-05-08"));
    expect(frames.request).toHaveBeenCalledOnce();

    fireEvent.pointerUp(window, { button: 0, clientX: 398 });

    expect(repository.updateStudyBlock).toHaveBeenCalledWith(
      "block_1",
      expect.objectContaining({ startDate: "2026-05-25", endDate: "2026-05-29" }),
    );
  });

  it("cancels a queued bar draft without publishing or writing", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    chart([topic]);
    const target = bar(/2026-05-04 to 2026-05-08/);
    const frames = stubAnimationFrames();

    fireEvent.pointerDown(target, { button: 0, pointerId: 41, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 41, clientX: 398 });
    fireEvent.pointerCancel(window, { pointerId: 41 });

    expect(frames.cancel).toHaveBeenCalledOnce();
    expect(target).toHaveAttribute("aria-label", expect.stringContaining("2026-05-04 to 2026-05-08"));
    expect(repository.updateStudyBlock).not.toHaveBeenCalled();
  });

  it("cancels a pan without leaving a panning listener", () => {
    chart([makeTopic({ name: "Glycolysis" })]);
    const scroller = document.querySelector<HTMLElement>(".timeline-scrollport")!;
    scroller.scrollLeft = 100;

    fireEvent.pointerDown(scroller, { button: 1, pointerId: 42, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 42, clientX: 120, clientY: 100 });
    const moved = scroller.scrollLeft;
    fireEvent.pointerCancel(window, { pointerId: 42 });
    expect(scroller).not.toHaveAttribute("data-timeline-panning");

    fireEvent.pointerMove(window, { pointerId: 42, clientX: 160, clientY: 100 });
    expect(scroller.scrollLeft).toBe(moved);
  });

  it("disposes an active gesture when the chart unmounts", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    const { unmount } = render(
      <TimelineView
        courses={[makeCourse({ topics: [topic] })]}
        health={new Map()}
        today="2026-05-01"
        selectedId={null}
        onSelectTopic={vi.fn()}
        onGoToOutline={vi.fn()}
      />,
    );
    const target = bar(/2026-05-04 to 2026-05-08/);
    fireEvent.pointerDown(target, { button: 0, pointerId: 43, clientX: 100 });
    fireEvent.pointerMove(window, { pointerId: 43, clientX: 200 });
    unmount();

    fireEvent.pointerMove(window, { pointerId: 43, clientX: 400 });
    fireEvent.pointerUp(window, { pointerId: 43, button: 0, clientX: 400 });
    expect(repository.updateStudyBlock).not.toHaveBeenCalled();
  });

  it("stops the whole selection where the first of its bars is blocked", () => {
    // `block_1` has a neighbour three days to its right; `block_3`, in another
    // topic, has open canvas. Dragging both must stop where the first one does,
    // or the two would arrive with a different gap between them than they left.
    const first = makeTopic({
      id: "topic_1",
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
        { id: "block_2", topicId: "topic_1", startDate: "2026-05-12", endDate: "2026-05-15", source: "auto" },
      ],
    });
    const second = makeTopic({
      id: "topic_2",
      name: "Krebs cycle",
      blocks: [
        { id: "block_3", topicId: "topic_2", startDate: "2026-05-04", endDate: "2026-05-06", source: "auto" },
      ],
    });
    chart([first, second]);

    const one = bar(/2026-05-04 to 2026-05-08/);
    const other = bar(/2026-05-04 to 2026-05-06/);
    fireEvent.pointerDown(one, { button: 0, clientX: 100 });
    fireEvent.pointerUp(window, { button: 0, clientX: 100 });
    fireEvent.pointerDown(other, { button: 0, clientX: 100, shiftKey: true });
    fireEvent.pointerUp(window, { button: 0, clientX: 100, shiftKey: true });

    // Two weeks to the right; three days is as far as `block_1` can go.
    fireEvent.pointerDown(other, { button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 296 });
    fireEvent.pointerUp(window, { button: 0, clientX: 296 });

    expect(repository.updateStudyBlock).toHaveBeenCalledWith(
      "block_1",
      expect.objectContaining({ startDate: "2026-05-07", endDate: "2026-05-11" }),
    );
    expect(repository.updateStudyBlock).toHaveBeenCalledWith(
      "block_3",
      expect.objectContaining({ startDate: "2026-05-07", endDate: "2026-05-09" }),
    );
  });

  it("selects everything the rubber band touches, and clears on a tap", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
        { id: "block_2", topicId: "topic_1", startDate: "2026-05-18", endDate: "2026-05-20", source: "auto" },
      ],
    });
    const onClearSelection = vi.fn();
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });
    const { container } = render(
      <TimelineView
        courses={[course]}
        health={new Map()}
        today="2026-05-01"
        selectedId={null}
        onSelectTopic={vi.fn()}
        onClearSelection={onClearSelection}
        onGoToOutline={vi.fn()}
      />,
    );

    const near = bar(/2026-05-04 to 2026-05-08/);
    const far = bar(/2026-05-18 to 2026-05-20/);
    for (const element of screen.getAllByRole("button", { name: /2026-05-04 to 2026-05-08/ })) {
      placeAt(element, 40, 100);
    }
    for (const element of screen.getAllByRole("button", { name: /2026-05-18 to 2026-05-20/ })) {
      placeAt(element, 400, 100);
    }

    const scroller = container.querySelector(".timeline-scrollport")!;
    fireEvent.pointerDown(scroller, { button: 0, clientX: 20, clientY: 90 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 130 });
    fireEvent.pointerUp(window, { button: 0, clientX: 200, clientY: 130 });

    expect(near).toHaveAttribute("data-selection", "primary");
    expect(far).not.toHaveAttribute("data-selection");

    // And a press on empty canvas that never travelled is "select nothing".
    fireEvent.pointerDown(scroller, { button: 0, clientX: 20, clientY: 90 });
    fireEvent.pointerUp(window, { button: 0, clientX: 20, clientY: 90 });
    expect(near).not.toHaveAttribute("data-selection");
    expect(onClearSelection).toHaveBeenCalled();
  });

  it("subtracts intersecting bars from the selection with Ctrl", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
        { id: "block_2", topicId: "topic_1", startDate: "2026-05-18", endDate: "2026-05-20", source: "auto" },
      ],
    });
    const { container } = render(
      <TimelineView
        courses={[makeCourse({ topics: [topic] })]}
        health={new Map()}
        today="2026-05-01"
        selectedId={null}
        onSelectTopic={vi.fn()}
        onGoToOutline={vi.fn()}
      />,
    );
    const near = bar(/2026-05-04 to 2026-05-08/);
    const far = bar(/2026-05-18 to 2026-05-20/);
    for (const element of screen.getAllByRole("button", { name: /2026-05-04 to 2026-05-08/ })) {
      placeAt(element, 40, 100);
    }
    for (const element of screen.getAllByRole("button", { name: /2026-05-18 to 2026-05-20/ })) {
      placeAt(element, 400, 100);
    }

    const scroller = container.querySelector(".timeline-scrollport")!;
    fireEvent.pointerDown(scroller, { button: 0, clientX: 20, clientY: 90 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 130 });
    fireEvent.pointerUp(window, { button: 0, clientX: 450, clientY: 130 });
    expect(near).toHaveAttribute("data-selection");
    expect(far).toHaveAttribute("data-selection");

    fireEvent.pointerDown(scroller, { button: 0, clientX: 20, clientY: 90, ctrlKey: true });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 130, ctrlKey: true });
    fireEvent.pointerUp(window, { button: 0, clientX: 200, clientY: 130, ctrlKey: true });
    expect(near).not.toHaveAttribute("data-selection");
    expect(far).toHaveAttribute("data-selection", "primary");
  });

  it("creates a block on the day the empty lane was right-clicked", () => {
    const topic = makeTopic({ name: "Glycolysis", blocks: [] });
    chart([topic]);

    const lane = document.querySelector<HTMLElement>(`[data-topic-lane="${topic.id}"]`)!;
    placeAt(lane, 0, 0, 1000, 24);
    fireEvent.contextMenu(lane, { clientX: 140, clientY: 10 });

    fireEvent.click(screen.getByRole("menuitem", { name: /New block on/ }));
    expect(repository.createStudyBlock).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: topic.id, source: "manual" }),
    );
    const input = repository.createStudyBlock.mock.calls[0][0];
    expect(input.startDate).toBe(input.endDate);
  });

  it("deletes a bar from its own menu", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      blocks: [
        { id: "block_1", topicId: "topic_1", startDate: "2026-05-04", endDate: "2026-05-08", source: "auto" },
      ],
    });
    chart([topic]);

    fireEvent.contextMenu(bar(/2026-05-04 to 2026-05-08/), { clientX: 100, clientY: 40 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete block" }));

    expect(repository.deleteStudyBlock).toHaveBeenCalledWith("block_1");
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

  it("keeps the chart mounted while the sidebar hides every course", () => {
    const topic = makeTopic({ name: "Glycolysis", blocks: [] });
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });
    const onGoToOutline = vi.fn();
    const { container, rerender } = render(
      <TimelineView
        courses={[course]}
        health={new Map()}
        today="2026-05-01"
        selectedId={null}
        onSelectTopic={vi.fn()}
        onGoToOutline={onGoToOutline}
      />,
    );
    const existing = container.querySelector(".timeline-scrollport");
    expect(existing).toBeInTheDocument();

    rerender(
      <TimelineView
        courses={[]}
        health={new Map()}
        today="2026-05-01"
        selectedId={null}
        onSelectTopic={vi.fn()}
        onGoToOutline={onGoToOutline}
      />,
    );

    expect(container.querySelector(".timeline-scrollport")).toBe(existing);
    expect(screen.getByRole("button", { name: "Open the outline" })).toBeInTheDocument();
  });
});
