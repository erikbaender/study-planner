import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT, FALLBACK_CAPACITY_UNITS } from "@/domain";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import type { PlanningPreview } from "./planning-summary";

const repository = {
  applySchedule: vi.fn(() => Promise.resolve()),
};
const run = vi.fn();
const { createPlanningPreview } = vi.hoisted(() => ({
  createPlanningPreview: vi.fn((): PlanningPreview => ({
    result: { blocks: [], shortfalls: [] },
    topicIds: [],
    days: 0,
  })),
}));

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerRun: () => run,
}));

vi.mock("./planning-summary", () => ({ createPlanningPreview }));

import { PlanningActions } from "./planning-actions";

describe("PlanningActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does no preview work while closed and computes the preview when opened", async () => {
    const user = userEvent.setup();
    const course = makeCourse({ topics: [makeTopic()] });
    const { rerender } = render(
      <PlanningActions courses={[course]} snapshot={EMPTY_SNAPSHOT} today="2026-05-01" />,
    );

    expect(createPlanningPreview).not.toHaveBeenCalled();

    rerender(
      <PlanningActions
        courses={[course]}
        snapshot={{
          ...EMPTY_SNAPSHOT,
          studyLog: [{ id: "log_1", topicId: "topic_1", date: "2026-05-01", units: 1 }],
        }}
        today="2026-05-01"
      />,
    );
    expect(createPlanningPreview).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Reflow" }));

    expect(await screen.findByRole("dialog", { name: "Plan Course" })).toBeInTheDocument();
    expect(createPlanningPreview).toHaveBeenCalledWith({
      courses: [course],
      today: "2026-05-01",
      calendar: EMPTY_SNAPSHOT.preferences,
      dailyCapacityUnits: FALLBACK_CAPACITY_UNITS,
    });

    const callsWhileOpen = createPlanningPreview.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(
      <PlanningActions
        courses={[course]}
        snapshot={{ ...EMPTY_SNAPSHOT, studyLog: [] }}
        today="2026-05-01"
      />,
    );

    expect(createPlanningPreview).toHaveBeenCalledTimes(callsWhileOpen);
  });

  it("applies blocks and preferences through exactly one repository promise", async () => {
    const user = userEvent.setup();
    const topic = makeTopic({ id: "topic_1" });
    const course = makeCourse({ topics: [topic] });
    const block = {
      topicId: topic.id,
      startDate: "2026-05-02",
      endDate: "2026-05-03",
      plannedUnits: 20,
    };
    createPlanningPreview.mockReturnValue({
      result: { blocks: [block], shortfalls: [] },
      topicIds: [topic.id],
      days: 2,
    });
    const operation = Promise.resolve();
    repository.applySchedule.mockReturnValueOnce(operation);

    render(<PlanningActions courses={[course]} snapshot={EMPTY_SNAPSHOT} today="2026-05-01" />);
    await user.click(screen.getByRole("button", { name: "Reflow" }));
    await user.click(await screen.findByRole("button", { name: "Apply plan" }));

    expect(repository.applySchedule).toHaveBeenCalledOnce();
    expect(repository.applySchedule).toHaveBeenCalledWith([topic.id], [block], {
      ...EMPTY_SNAPSHOT.preferences,
      dailyCapacityUnits: FALLBACK_CAPACITY_UNITS,
    });
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(operation);
    expect(screen.queryByRole("dialog", { name: "Plan Course" })).not.toBeInTheDocument();
  });
});
