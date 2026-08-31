import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { assessCourse, DEFAULT_PREFERENCES } from "@/domain";
import { course as makeCourse, exam as makeExam, plan as makePlan, topic as makeTopic } from "@/test/factories";
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
    const onSelectCourse = vi.fn();
    const shared = {
      plans: [plan],
      plan,
      health,
      today: TODAY,
      focus: { kind: "all" } as const,
      query: "",
      selectedCourseId: null,
      onSelectPlan: vi.fn(),
      onNewPlan: vi.fn(),
      onEditPlan: vi.fn(),
      onDeletePlan: vi.fn(),
      onSetFocus: vi.fn(),
      onSelectCourse,
      onToggleHidden: vi.fn(),
      onHideAll: vi.fn(),
      onShowAll: vi.fn(),
      onNewCourse: vi.fn(),
    };

    const { rerender } = render(
      <AppSidebar {...shared} hiddenCourseIds={[]} />,
    );
    const user = userEvent.setup();
    const courseButton = screen.getByRole("button", { name: "Inspect Biochemistry" });
    courseButton.focus();
    await user.keyboard("{Enter}");
    expect(onSelectCourse).toHaveBeenCalledWith(course);
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide Biochemistry" }).querySelector(".lucide-eye-off"),
    ).toBeInTheDocument();
    const hideButton = screen.getByRole("button", { name: "Hide Biochemistry" });
    expect(courseButton).not.toContainElement(hideButton);
    await user.click(hideButton);
    expect(hideButton).not.toHaveFocus();
    expect(onSelectCourse).toHaveBeenCalledTimes(1);

    rerender(
      <AppSidebar {...shared} hiddenCourseIds={[course.id]} />,
    );
    expect(screen.getByText("7d")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show Biochemistry" }).querySelector(".lucide-eye"),
    ).toBeInTheDocument();
    const row = screen.getByText("Biochemistry").closest("li");
    expect(within(row!).getByText("7d").closest(".opacity-40")).toBeInTheDocument();
  });

  it("marks the selected course on its native navigation button", () => {
    const course = makeCourse({ name: "Biochemistry" });
    const plan = makePlan({ courses: [course] });

    render(
      <AppSidebar
        plans={[plan]}
        plan={plan}
        health={new Map()}
        today={TODAY}
        focus={{ kind: "all" }}
        hiddenCourseIds={[]}
        query=""
        selectedCourseId={course.id}
        onSelectPlan={vi.fn()}
        onNewPlan={vi.fn()}
        onEditPlan={vi.fn()}
        onDeletePlan={vi.fn()}
        onSetFocus={vi.fn()}
        onSelectCourse={vi.fn()}
        onToggleHidden={vi.fn()}
        onHideAll={vi.fn()}
        onShowAll={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Inspect Biochemistry" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("sorts filtered courses alphabetically", () => {
    const plan = makePlan({
      courses: [makeCourse({ name: "Physiology" }), makeCourse({ name: "anatomy" })],
    });
    render(
      <AppSidebar
        plans={[plan]}
        plan={plan}
        health={new Map()}
        today={TODAY}
        focus={{ kind: "all" }}
        hiddenCourseIds={[]}
        query=""
        selectedCourseId={null}
        onSelectPlan={vi.fn()}
        onNewPlan={vi.fn()}
        onEditPlan={vi.fn()}
        onDeletePlan={vi.fn()}
        onSetFocus={vi.fn()}
        onSelectCourse={vi.fn()}
        onToggleHidden={vi.fn()}
        onHideAll={vi.fn()}
        onShowAll={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    const rows = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent)
      .filter((text) => text === "anatomy" || text === "Physiology");
    expect(rows).toEqual([expect.stringContaining("anatomy"), expect.stringContaining("Physiology")]);
  });

  it("keeps every course visible while search filters the main content", () => {
    const plan = makePlan({
      courses: [
        makeCourse({ name: "Biology", topics: [makeTopic({ name: "Cellular respiration" })] }),
        makeCourse({ name: "Chemistry" }),
      ],
    });
    render(
      <AppSidebar
        plans={[plan]}
        plan={plan}
        health={new Map()}
        today={TODAY}
        focus={{ kind: "all" }}
        hiddenCourseIds={[]}
        query="respiration"
        selectedCourseId={null}
        onSelectPlan={vi.fn()}
        onNewPlan={vi.fn()}
        onEditPlan={vi.fn()}
        onDeletePlan={vi.fn()}
        onSetFocus={vi.fn()}
        onSelectCourse={vi.fn()}
        onToggleHidden={vi.fn()}
        onHideAll={vi.fn()}
        onShowAll={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    expect(screen.getByText("Biology")).toBeInTheDocument();
    expect(screen.getByText("Chemistry")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search" })).toBeInTheDocument();
  });

  it("highlights a course when all sized topics are complete", () => {
    const course = makeCourse({
      name: "Finished course",
      color: "#ff3b30",
      topics: [makeTopic({ totalUnits: 10, completedUnits: 10 })],
    });
    const plan = makePlan({ courses: [course] });

    render(

        <AppSidebar
          plans={[plan]}
          plan={plan}
          health={new Map()}
          today={TODAY}
          focus={{ kind: "all" }}
          hiddenCourseIds={[]}
          query=""
          selectedCourseId={null}
          onSelectPlan={vi.fn()}
          onNewPlan={vi.fn()}
          onEditPlan={vi.fn()}
          onDeletePlan={vi.fn()}
          onSetFocus={vi.fn()}
          onSelectCourse={vi.fn()}
          onToggleHidden={vi.fn()}
          onHideAll={vi.fn()}
          onShowAll={vi.fn()}
          onNewCourse={vi.fn()}
        />
      ,
    );

    const row = screen.getByText("Finished course").closest("li");
    expect(row).toHaveAttribute("data-course-completed", "true");
    expect(row).toHaveStyle({ "--topic-completion-color": "#e8684a" });
  });
});
