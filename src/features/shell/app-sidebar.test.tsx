import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { assessCourse, DEFAULT_PREFERENCES } from "@/domain";
import { course as makeCourse, exam as makeExam, plan as makePlan } from "@/test/factories";
import { TooltipProvider } from "@/ui";
import { AppSidebar } from "./app-sidebar";

const TODAY = "2026-05-01";

describe("AppSidebar course visibility", () => {
  it("keeps countdowns mounted and uses eye icons for actions, not state", async () => {
    const course = makeCourse({
      name: "Biochemistry",
      exams: [makeExam({ startDate: "2026-05-08" })],
    });
    const plan = makePlan({ courses: [course] });
    const health = new Map([
      [
        course.id,
        assessCourse({ course, today: TODAY, calendar: DEFAULT_PREFERENCES, log: [] }),
      ],
    ]);
    const shared = {
      plans: [plan],
      plan,
      health,
      focus: { kind: "all" } as const,
      query: "",
      onSelectPlan: vi.fn(),
      onNewPlan: vi.fn(),
      onEditPlan: vi.fn(),
      onDeletePlan: vi.fn(),
      onSetFocus: vi.fn(),
      onToggleHidden: vi.fn(),
      onHideAll: vi.fn(),
      onShowAll: vi.fn(),
      onNewCourse: vi.fn(),
    };

    const { rerender } = render(
      <TooltipProvider><AppSidebar {...shared} hiddenCourseIds={[]} /></TooltipProvider>,
    );
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide Biochemistry" }).querySelector(".lucide-eye-off"),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    const hideButton = screen.getByRole("button", { name: "Hide Biochemistry" });
    await user.click(hideButton);
    expect(hideButton).not.toHaveFocus();

    rerender(
      <TooltipProvider><AppSidebar {...shared} hiddenCourseIds={[course.id]} /></TooltipProvider>,
    );
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show Biochemistry" }).querySelector(".lucide-eye"),
    ).toBeInTheDocument();
    const row = screen.getByText("Biochemistry").closest("li");
    expect(within(row!).getByText("7d").closest(".opacity-40")).toBeInTheDocument();
  });

  it("sorts filtered courses alphabetically", () => {
    const plan = makePlan({
      courses: [makeCourse({ name: "Physiology" }), makeCourse({ name: "anatomy" })],
    });
    render(
      <TooltipProvider><AppSidebar
        plans={[plan]}
        plan={plan}
        health={new Map()}
        focus={{ kind: "all" }}
        hiddenCourseIds={[]}
        query=""
        onSelectPlan={vi.fn()}
        onNewPlan={vi.fn()}
        onEditPlan={vi.fn()}
        onDeletePlan={vi.fn()}
        onSetFocus={vi.fn()}
        onToggleHidden={vi.fn()}
        onHideAll={vi.fn()}
        onShowAll={vi.fn()}
        onNewCourse={vi.fn()}
      /></TooltipProvider>,
    );

    const rows = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent)
      .filter((text) => text === "anatomy" || text === "Physiology");
    expect(rows).toEqual([expect.stringContaining("anatomy"), expect.stringContaining("Physiology")]);
  });
});
