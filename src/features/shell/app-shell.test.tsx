import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyBlock } from "@/domain";
import { useWorkspace } from "@/features/workspace/store";
import { AppShell } from "./app-shell";

const block = {
  id: "block_b",
  topicId: "topic_1",
  startDate: "2026-05-04",
  endDate: "2026-05-08",
  source: "manual",
} satisfies StudyBlock;

const topic = {
  id: "topic_1",
  courseId: "course_1",
  name: "Glycolysis",
  unit: "slides",
  totalUnits: 0,
  completedUnits: 0,
  dependencyIds: [],
  color: "violet",
  notes: "",
  order: 0,
  blocks: [block],
};

const course = {
  id: "course_1",
  planId: "plan_1",
  name: "Biochemistry",
  color: "violet",
  notes: "",
  order: 0,
  exams: [],
  topics: [topic],
};

const snapshot = {
  plans: [{ id: "plan_1", name: "Spring", notes: "", courses: [course] }],
  studyLog: [],
  preferences: {
    dailyCapacityUnits: undefined,
    studyDaysOfWeek: [1, 2, 3, 4, 5, 6],
    blackoutDates: [],
    theme: "system",
    accentColor: "#1769e0",
  },
};

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
  useConvexAuth: () => ({ isAuthenticated: false }),
}));

vi.mock("@/data/use-repository", () => ({
  useRepository: () => ({}),
  usePlannerState: () => ({ status: "ready", snapshot }),
  usePlannerErrors: () => ({ error: null, run: vi.fn(), clear: vi.fn() }),
}));

vi.mock("@/features/timeline/timeline-view", () => ({
  TimelineView: ({ onSelectBlock }: { onSelectBlock?: (selected: StudyBlock) => void }) => (
    <button type="button" onClick={() => onSelectBlock?.(block)}>
      Mock timeline block
    </button>
  ),
}));

vi.mock("./app-toolbar", () => ({ AppToolbar: () => null }));
vi.mock("./app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("./command-palette", () => ({ CommandPalette: () => null }));
vi.mock("./inspector", () => ({ Inspector: () => null }));
vi.mock("./sheets", () => ({
  ConfirmDeleteSheet: () => null,
  NewCourseSheet: () => null,
  NewPlanSheet: () => null,
  SampleDataSheet: () => null,
}));
vi.mock("@/features/outline/outline-view", () => ({ OutlineView: () => null }));
vi.mock("@/features/today/today-view", () => ({ TodayView: () => null }));

const initialWorkspace = useWorkspace.getState();

beforeEach(() => {
  useWorkspace.setState(initialWorkspace, true);
  useWorkspace.getState().setView("timeline");
});

describe("AppShell timeline selection wiring", () => {
  it("sets the workspace block selection when the chart reports its primary block", async () => {
    // The chart reports the block that remains primary after a set operation.
    // Re-selecting that id must keep the inspector open while the chart still
    // owns the highlight; a toggle would erase the very selection it reports.
    useWorkspace.getState().select({ kind: "block", id: block.id });
    render(<AppShell />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Mock timeline block" }));

    expect(useWorkspace.getState().selection).toEqual({ kind: "block", id: block.id });
  });
});
