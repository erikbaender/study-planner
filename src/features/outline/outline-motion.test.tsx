import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, snapshot as makeSnapshot } from "@/test/factories";
import { OutlineView } from "./outline-view";

vi.mock("@/data/use-repository", () => ({
  useRepository: () => ({}),
  usePlannerRun: () => vi.fn(),
  usePlannerErrors: () => ({ run: vi.fn(), error: null, clear: vi.fn() }),
}));

/** jsdom has no computed motion duration; `motionDuration` falls back to 240ms. */
const HALF = 120;

const biochemistry = makeCourse({ name: "Biochemistry" });
const anatomy = makeCourse({ name: "Anatomy" });
const shared = {
  health: new Map(),
  today: "2026-05-01",
  query: "",
  snapshot: makeSnapshot(),
  selectedId: null,
  onSelectTopic: vi.fn(),
  onSelectExam: vi.fn(),
  onDeleteExam: vi.fn(),
  onSelectCourse: vi.fn(),
  onDeleteTopic: vi.fn(),
  onDeleteCourse: vi.fn(),
  onEditCourse: vi.fn(),
  onNewCourse: vi.fn(),
};

/** The box a card arrives and leaves in, found by the course it holds. */
function boxFor(name: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(".collapse-motion")].find((box) =>
      box.textContent?.includes(name),
    ) ?? null
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  return () => vi.useRealTimers();
});

/**
 * The outline filters whole cards rather than fixed-height rows, and it used to
 * do it with an opacity fade alone: the card faded, and every card below it
 * jumped into the space in the frame the fade ended. These are the same two
 * stages the chart's rows have, in the same order.
 */
describe("course cards arriving and leaving the outline", () => {
  it("fades a filtered-out card first, then closes the space it took", () => {
    const { rerender } = render(<OutlineView {...shared} courses={[biochemistry, anatomy]} />);
    expect(boxFor("Biochemistry")).toHaveAttribute("data-phase", "shown");

    rerender(<OutlineView {...shared} courses={[anatomy]} />);

    // Phase one: still there, still taking its room, fading out of it. The card
    // below it must not have moved yet.
    const leaving = boxFor("Biochemistry")!;
    expect(leaving).toHaveAttribute("data-phase", "fade");
    expect(leaving).toHaveClass("opacity-0");
    expect(boxFor("Anatomy")).toHaveAttribute("data-phase", "shown");

    // Phase two: the room goes, once there is nothing visible in it.
    act(() => vi.advanceTimersByTime(HALF));
    expect(boxFor("Biochemistry")).toHaveAttribute("data-phase", "shrink");
    expect(boxFor("Biochemistry")!.style.height).toBe("0px");

    // And then the card itself, so a hidden course costs nothing to have.
    act(() => vi.advanceTimersByTime(HALF));
    expect(boxFor("Biochemistry")).toBeNull();
  });

  it("opens the space for an arriving card before fading it in", () => {
    const { rerender } = render(<OutlineView {...shared} courses={[anatomy]} />);

    rerender(<OutlineView {...shared} courses={[biochemistry, anatomy]} />);

    // Mounted with no room at all, so the growth has a start value.
    const arriving = boxFor("Biochemistry")!;
    expect(arriving).toHaveAttribute("data-phase", "enter");
    expect(arriving.style.height).toBe("0px");
    expect(arriving).toHaveClass("opacity-0");

    // Two frames later the room opens, and the card is still not legible in it.
    act(() => vi.advanceTimersByTime(34));
    expect(boxFor("Biochemistry")).toHaveAttribute("data-phase", "grow");
    expect(boxFor("Biochemistry")).toHaveClass("opacity-0");

    // Only once the room exists does what goes in it appear.
    act(() => vi.advanceTimersByTime(HALF));
    expect(boxFor("Biochemistry")).toHaveAttribute("data-phase", "shown");
    expect(boxFor("Biochemistry")).toHaveClass("opacity-100");
  });

  it("lets a card filtered back in mid-departure stop leaving rather than restart", () => {
    const { rerender } = render(<OutlineView {...shared} courses={[biochemistry, anatomy]} />);

    rerender(<OutlineView {...shared} courses={[anatomy]} />);
    expect(boxFor("Biochemistry")).toHaveAttribute("data-phase", "fade");

    // It still has its room, so all it has to do is come back into it.
    rerender(<OutlineView {...shared} courses={[biochemistry, anatomy]} />);
    expect(boxFor("Biochemistry")).toHaveAttribute("data-phase", "shown");
  });
});
