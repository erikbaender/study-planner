import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  scheduleCourses,
  type PlannerSnapshot,
  type ScheduleResult,
} from "@/domain";
import { course, exam, plan, topic } from "@/test/factories";
import { TodayView } from "./TodayView";

const TODAY = "2026-07-30";
const cellBiology = topic({
  id: "topic_cell",
  name: "Cell biology",
  totalUnits: 100,
  completedUnits: 20,
  blocks: [
    {
      id: "block_today",
      topicId: "topic_cell",
      startDate: TODAY,
      endDate: TODAY,
      plannedUnits: 25,
      source: "auto",
    },
  ],
});
const biochemistry = course({
  id: "course_bio",
  name: "Biochemistry",
  exams: [exam({ id: "exam_bio", startDate: "2026-08-10" })],
  topics: [cellBiology],
});
const semester = plan({ courses: [biochemistry] });
const snapshot: PlannerSnapshot = {
  plans: [semester],
  preferences: { ...DEFAULT_PREFERENCES, dailyCapacityUnits: 40 },
  studyLog: [
    {
      id: "log_today",
      topicId: cellBiology.id,
      date: TODAY,
      units: 5,
    },
  ],
};

function result(capacity = 40): ScheduleResult {
  return scheduleCourses({
    courses: semester.courses,
    today: TODAY,
    preferences: snapshot.preferences,
    dailyCapacityUnits: capacity,
  });
}

function renderToday(overrides: Partial<React.ComponentProps<typeof TodayView>> = {}) {
  const props: React.ComponentProps<typeof TodayView> = {
    plan: semester,
    snapshot,
    today: TODAY,
    smartView: "today",
    onSelectCourse: vi.fn(),
    onSelectTopic: vi.fn(),
    onCreate: vi.fn(),
    schedule: result(),
    capacity: "40",
    hasAutoSchedule: true,
    planning: false,
    onCapacityChange: vi.fn(),
    onApplySchedule: vi.fn(),
    onLogStudy: vi.fn(),
    ...overrides,
  };
  render(<TodayView {...props} />);
  return props;
}

describe("TodayView", () => {
  it("turns today's generated block into a next-up checklist with inline logging", async () => {
    const user = userEvent.setup();
    const props = renderToday();

    expect(screen.getByRole("heading", { name: "Next up" })).toBeInTheDocument();
    expect(screen.getByText(/5\/25 slides/)).toBeInTheDocument();
    expect(screen.getByText("Behind")).toBeInTheDocument();

    const stepper = screen.getByRole("spinbutton", {
      name: "Cell biology, Biochemistry units done",
    });
    fireEvent.change(stepper, { target: { value: "7" } });
    await user.click(
      screen.getByRole("button", { name: "Log Cell biology, Biochemistry units" }),
    );
    expect(props.onLogStudy).toHaveBeenCalledWith(cellBiology.id, 7);

    await user.click(
      screen.getByRole("checkbox", {
        name: "Complete Cell biology, Biochemistry target",
      }),
    );
    expect(props.onLogStudy).toHaveBeenCalledWith(cellBiology.id, 20);

    await user.click(screen.getByRole("button", { name: "Open Cell biology, Biochemistry" }));
    expect(props.onSelectTopic).toHaveBeenCalledWith(cellBiology.id, biochemistry.id);
  });

  it("presents the saved schedule as a reversible What-if preview", async () => {
    const user = userEvent.setup();
    const onCapacityChange = vi.fn();
    const onApplySchedule = vi.fn();
    renderToday({ onCapacityChange, onApplySchedule });

    expect(screen.getByText(/units fit across/)).toBeInTheDocument();
    const capacity = screen.getByRole("spinbutton", { name: "What-if daily capacity" });
    fireEvent.change(capacity, { target: { value: "60" } });
    expect(onCapacityChange).toHaveBeenLastCalledWith("60");

    await user.click(screen.getByRole("button", { name: "Reflow from today" }));
    expect(onApplySchedule).toHaveBeenCalledTimes(1);
  });

  it("states infeasibility and disables generation when capacity is unknown", () => {
    renderToday({
      schedule: {
        ...result(),
        blocks: [],
        capacityUnits: null,
        feasible: false,
      },
      capacity: "",
      hasAutoSchedule: false,
    });

    expect(screen.getByText("Set a positive capacity to preview a schedule.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto-plan semester" })).toBeDisabled();
  });

  it("offers Reflow from the Behind smart view", async () => {
    const user = userEvent.setup();
    const onApplySchedule = vi.fn();
    renderToday({
      smartView: "behind",
      onApplySchedule,
      snapshot: { ...snapshot, studyLog: [] },
    });

    expect(screen.getByRole("heading", { name: "Behind" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reflow" }));
    expect(onApplySchedule).toHaveBeenCalledTimes(1);
  });
});
