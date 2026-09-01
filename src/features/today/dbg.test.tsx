import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT, type Course } from "@/domain";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import { TodayView } from "@/features/today/today-view";

vi.mock("@/data/use-repository", () => ({
  useRepository: () => ({}),
  usePlannerRun: () => vi.fn(),
  usePlannerErrors: () => ({ run: vi.fn(), error: null, clear: vi.fn() }),
}));

const anatomy: Course = makeCourse({ name: "Anatomy", topics: [makeTopic({ name: "T", totalUnits: 10, completedUnits: 4 })] });
const view = (courses: readonly Course[]) => (
  <TodayView courses={courses} health={new Map()} studyLog={[]} snapshot={EMPTY_SNAPSHOT}
    today="2026-05-01" selectedTopicId={null} onSelectTopic={vi.fn()} onDeleteTopic={vi.fn()} />
);

beforeEach(() => { vi.useFakeTimers(); return () => vi.useRealTimers(); });

describe("dbg", () => {
  it("traces the handover", () => {
    const { rerender } = render(view([anatomy]));
    rerender(view([]));
    act(() => vi.advanceTimersByTime(120));
    rerender(view([anatomy]));
    const p = () => [...document.querySelectorAll(".presence-fade")].map(e => (e as HTMLElement).dataset.phase ?? "content");
    console.log("t=0", p());
    act(() => vi.advanceTimersByTime(120));
    console.log("t=120", p());
    act(() => vi.advanceTimersByTime(120));
    console.log("t=240", p());
    act(() => vi.advanceTimersByTime(500));
    console.log("t=740", p());
    expect(true).toBe(true);
  });
});
