import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assessCourse,
  DEFAULT_PREFERENCES,
  EMPTY_SNAPSHOT,
  type Course,
  type CourseHealth,
} from "@/domain";
import { course as makeCourse, exam as makeExam, topic as makeTopic } from "@/test/factories";
import { TodayView } from "./today-view";

vi.mock("@/data/use-repository", () => ({
  useRepository: () => ({}),
  usePlannerRun: () => vi.fn(),
  usePlannerErrors: () => ({ run: vi.fn(), error: null, clear: vi.fn() }),
}));

/** jsdom has no computed motion duration; `motionDuration` falls back to 240ms. */
const HALF = 120;
const TODAY = "2026-05-01";

/** Started but unfinished, so it lands in "Pick up where you left off". */
function startedCourse(name: string): Course {
  return makeCourse({
    name,
    exams: [makeExam({ name: `${name} exam`, startDate: "2026-06-01" })],
    topics: [makeTopic({ name: `${name} topic`, totalUnits: 10, completedUnits: 4 })],
  });
}

const biochemistry = startedCourse("Biochemistry");
const anatomy = startedCourse("Anatomy");

function healthOf(courses: readonly Course[]): Map<string, CourseHealth> {
  return new Map(
    courses.map((course) => [
      course.id,
      assessCourse({ course, today: TODAY, calendar: DEFAULT_PREFERENCES, log: [] }),
    ]),
  );
}

function today(courses: readonly Course[]) {
  return (
    <TodayView
      courses={courses}
      health={healthOf(courses)}
      studyLog={[]}
      snapshot={EMPTY_SNAPSHOT}
      today={TODAY}
      selectedTopicId={null}
      onSelectTopic={vi.fn()}
      onDeleteTopic={vi.fn()}
    />
  );
}

/** Every box in the view that arrives and leaves, in document order. */
function phases(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".collapse-motion")].map(
    (box) => box.dataset.phase ?? "",
  );
}

function boxFor(text: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(".collapse-motion")].find((box) =>
      box.textContent?.includes(text),
    ) ?? null
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  return () => vi.useRealTimers();
});

/**
 * Today was the one view a filter change did nothing to: its four lists were
 * rewritten between two frames while the outline and the chart animated the
 * very same change. These are the two stages those two already had.
 */
describe("Today's lists arriving and leaving", () => {
  it("fades a filtered-out row first, then closes the space it took", () => {
    const { rerender } = render(today([biochemistry, anatomy]));
    expect(boxFor("Biochemistry topic")).toHaveAttribute("data-phase", "shown");

    rerender(today([anatomy]));

    // Phase one: still there, still taking its room, fading out of it.
    expect(boxFor("Biochemistry topic")).toHaveAttribute("data-phase", "fade");
    expect(boxFor("Anatomy topic")).toHaveAttribute("data-phase", "shown");

    // Phase two: the room goes, once there is nothing visible in it.
    act(() => vi.advanceTimersByTime(HALF));
    expect(boxFor("Biochemistry topic")).toHaveAttribute("data-phase", "shrink");
    expect(boxFor("Biochemistry topic")!.style.height).toBe("0px");

    act(() => vi.advanceTimersByTime(HALF));
    expect(boxFor("Biochemistry topic")).toBeNull();
  });

  it("takes the whole 'Behind' card away when nothing is behind any more", () => {
    // An exam yesterday with work still on it is behind by definition.
    const slipping = makeCourse({
      name: "Slipping",
      exams: [makeExam({ name: "Past", startDate: "2026-05-05" })],
      topics: [makeTopic({ name: "Unfinished", totalUnits: 400, completedUnits: 0 })],
    });
    const { rerender } = render(today([slipping, anatomy]));
    const card = screen.getByRole("heading", { name: "Behind" }).closest(".collapse-motion");
    expect(card).toHaveAttribute("data-phase", "shown");

    rerender(today([anatomy]));
    expect(screen.getByRole("heading", { name: "Behind" }).closest(".collapse-motion")).toHaveAttribute(
      "data-phase",
      "fade",
    );

    act(() => vi.advanceTimersByTime(HALF));
    expect(screen.getByRole("heading", { name: "Behind" }).closest(".collapse-motion")).toHaveAttribute(
      "data-phase",
      "shrink",
    );

    act(() => vi.advanceTimersByTime(HALF));
    expect(screen.queryByRole("heading", { name: "Behind" })).not.toBeInTheDocument();
  });

  /**
   * The lists are four state machines, and they used to be four clocks. One
   * holding a row that had just arrived restarted its timer two frames in and
   * dragged every row leaving beside it late with it, so the halves of one
   * filter change visibly came apart.
   */
  it("moves every list to the next stage in the same tick", () => {
    const { rerender } = render(today([biochemistry, anatomy]));

    // Anatomy leaves and a third course arrives, so some lists gain a row while
    // others lose one, and both happen in every list at once.
    const physiology = startedCourse("Physiology");
    rerender(today([biochemistry, physiology]));

    const leaving = phases().filter((phase) => phase === "fade");
    const arriving = phases().filter((phase) => phase === "enter");
    expect(leaving.length).toBeGreaterThan(1);
    expect(arriving.length).toBeGreaterThan(1);

    // Two frames later the arrivals have started growing. That is how an
    // arrival begins, not how long it lasts: nothing else may have moved.
    act(() => vi.advanceTimersByTime(34));
    expect(phases().filter((phase) => phase === "fade")).toHaveLength(leaving.length);

    // And then one tick takes every list to its second stage together.
    act(() => vi.advanceTimersByTime(HALF));
    expect(phases()).not.toContain("fade");
    expect(phases()).not.toContain("grow");
  });
});

describe("Today when the focus holds nothing", () => {
  it("hands the view over to the message, and takes it back", () => {
    const { rerender } = render(today([anatomy]));
    expect(document.querySelector(".presence-fade[data-phase]")).toBeNull();

    rerender(today([]));
    // The content is on its way out; the message is not legible yet.
    const message = document.querySelector<HTMLElement>(".presence-fade[data-phase]")!;
    expect(message).toHaveClass("opacity-0");
    expect(screen.getByRole("heading", { name: "Nothing in focus" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(HALF));
    expect(document.querySelector(".presence-fade[data-phase]")).toHaveClass("opacity-100");

    // And back: the message leaves before the content returns.
    rerender(today([anatomy]));
    expect(document.querySelector(".presence-fade[data-phase]")).toHaveClass("opacity-0");
    act(() => vi.advanceTimersByTime(HALF * 2));
    expect(document.querySelector(".presence-fade[data-phase]")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Nothing in focus" })).not.toBeInTheDocument();
  });
});
