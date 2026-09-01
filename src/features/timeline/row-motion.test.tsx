import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import { TimelineView } from "./timeline-view";

vi.mock("@/data/use-repository", () => ({
  useRepository: () => ({}),
  usePlannerRun: () => vi.fn(),
  usePlannerErrors: () => ({ run: vi.fn(), error: null, clear: vi.fn() }),
}));

/** jsdom has no computed motion duration; `motionDuration` falls back to 240ms. */
const HALF = 120;

const topics = [
  makeTopic({ id: "topic_1", name: "Herz" }),
  makeTopic({ id: "topic_2", name: "Niere" }),
];
const course = makeCourse({ name: "Physio", topics });
// Given a block, so its lane draws a roll-up bar: the bar is what proves the
// lane keeps its topics while it leaves rather than emptying itself first.
const anatomy = makeCourse({
  name: "Anatomie",
  topics: [
    makeTopic({
      id: "topic_3",
      name: "Bein",
      blocks: [
        {
          id: "block_1",
          topicId: "topic_3",
          startDate: "2026-05-04",
          endDate: "2026-05-06",
          source: "auto" as const,
        },
      ],
    }),
  ],
});
const shared = {
  courses: [course],
  health: new Map(),
  today: "2026-05-01",
  selectedId: null,
  onSelectTopic: vi.fn(),
};

/** The box a course's whole lane arrives and leaves in. */
function laneBoxFor(name: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(".collapse-motion")].find((box) =>
      box.textContent?.includes(name),
    ) ?? null
  );
}

/** The lane on the canvas for a topic in the combined lane. */
function laneFor(name: string): HTMLElement {
  const topic = topics.find((candidate) => candidate.name === name)!;
  return document.querySelector<HTMLElement>(`[data-topic-lane="${topic.id}"]`)!;
}

beforeEach(() => {
  vi.useFakeTimers();
  return () => vi.useRealTimers();
});

describe("rows arriving and leaving", () => {
  it("fades a filtered-out row first, then collapses the space it took", () => {
    const { rerender } = render(<TimelineView {...shared} query="" />);
    expect(laneFor("Niere").style.height).toBe("24px");

    rerender(<TimelineView {...shared} query="Niere" />);

    // Phase one: the row is still there, at its full height, fading.
    const leaving = laneFor("Herz");
    expect(leaving.style.opacity).toBe("0");
    expect(leaving.style.height).toBe("24px");
    // The collapsing row already carries the rows below it; FLIP must not
    // animate those rows a second time when the filtered key disappears.
    expect(laneFor("Niere").style.transform).toBe("");

    // Phase two: the space goes, once there is nothing visible in it.
    act(() => vi.advanceTimersByTime(HALF));
    expect(laneFor("Herz").style.height).toBe("0px");

    // And then the row itself.
    act(() => vi.advanceTimersByTime(HALF));
    expect(document.querySelector(`[data-topic-lane="${topics[0].id}"]`)).toBeNull();
    expect(screen.getAllByText("Niere").length).toBeGreaterThan(0);
  });

  it("makes room for an arriving row before its label fades in", () => {
    const { rerender } = render(<TimelineView {...shared} query="Herz" />);
    act(() => vi.advanceTimersByTime(HALF * 2));

    rerender(<TimelineView {...shared} query="" />);
    // Mounted at zero height, so the growth has a start value to animate from.
    expect(laneFor("Niere").style.height).toBe("0px");
    expect(laneFor("Niere").style.opacity).toBe("0");

    // Two frames later the row grows; the label is still invisible.
    act(() => vi.advanceTimersByTime(34));
    expect(laneFor("Niere").style.height).toBe("24px");
    expect(laneFor("Niere").style.opacity).toBe("0");

    // And only once the room exists does what goes in it appear.
    act(() => vi.advanceTimersByTime(HALF));
    expect(laneFor("Niere").style.opacity).toBe("1");
  });
});

/**
 * A course hidden in the sidebar used to leave the chart in a single frame,
 * taking every lane below it up with it. It leaves the way the rows inside it
 * do now: the same two stages, in the same order, on the same clock.
 */
describe("course lanes arriving and leaving", () => {
  it("fades a filtered-out course's lane first, then collapses the room it took", () => {
    const both = { ...shared, courses: [course, anatomy] };
    const { rerender } = render(<TimelineView {...both} query="" />);
    expect(laneBoxFor("Anatomie")).toHaveAttribute("data-phase", "shown");

    rerender(<TimelineView {...both} courses={[course]} query="" />);

    // Phase one: the lane is still there, still taking its room, fading — and
    // it still draws the topics it had rather than emptying itself first.
    const leaving = laneBoxFor("Anatomie")!;
    expect(leaving).toHaveAttribute("data-phase", "fade");
    expect(leaving).toHaveClass("opacity-0");
    // Still drawing what it had: a lane that dropped its topics on the way out
    // would fade out already blank.
    expect(leaving.querySelector('[role="img"]')).not.toBeNull();

    // Phase two: the room goes, once there is nothing visible in it.
    act(() => vi.advanceTimersByTime(HALF));
    expect(laneBoxFor("Anatomie")).toHaveAttribute("data-phase", "shrink");

    act(() => vi.advanceTimersByTime(HALF));
    expect(laneBoxFor("Anatomie")).toBeNull();
  });

  it("makes room for an arriving lane before it fades in", () => {
    const { rerender } = render(<TimelineView {...shared} query="" />);

    rerender(<TimelineView {...shared} courses={[course, anatomy]} query="" />);
    const arriving = laneBoxFor("Anatomie")!;
    expect(arriving).toHaveAttribute("data-phase", "enter");
    expect(arriving.style.height).toBe("0px");

    act(() => vi.advanceTimersByTime(34));
    expect(laneBoxFor("Anatomie")).toHaveAttribute("data-phase", "grow");
    expect(laneBoxFor("Anatomie")).toHaveClass("opacity-0");

    act(() => vi.advanceTimersByTime(HALF));
    expect(laneBoxFor("Anatomie")).toHaveAttribute("data-phase", "shown");
  });
});
