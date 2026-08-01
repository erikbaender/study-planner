"use client";

/**
 * The source list.
 *
 * Two sections, and the split between them is the app's navigation model:
 *
 * - **Focus** is three questions — everything, what is behind, what is coming.
 *   They are computed from live metrics on every render, so a course leaves
 *   "Behind" the moment it stops being behind. Nothing is filed anywhere.
 * - **Courses** is the source list proper: colour dot, name, progress, exam
 *   countdown. Selecting one narrows the focus to it.
 *
 * The semester sits in the header as a menu rather than as a third section.
 * There is usually one, occasionally two, and never enough to deserve a list
 * competing with the courses for the eye.
 */

import { AlertTriangle, CalendarClock, ChevronsUpDown, Layers, Plus, Trash2 } from "lucide-react";
import type { Course, CourseHealth, Plan } from "@/domain";
import { courseProgress } from "@/domain";
import {
  ContextMenu,
  CountdownBadge,
  DropdownMenu,
  IconButton,
  Sidebar,
  SidebarItem,
  SidebarSection,
  Tooltip,
} from "@/ui";
import { hasExamSoon, isBehind, matchesQuery } from "@/features/workspace/scope";
import type { Focus, Selection } from "@/features/workspace/store";

export function AppSidebar({
  plans,
  plan,
  health,
  focus,
  selection,
  query,
  onSelectPlan,
  onNewPlan,
  onSetFocus,
  onSelectCourse,
  onNewCourse,
  onDeleteCourse,
}: {
  plans: readonly Plan[];
  plan: Plan | undefined;
  health: Map<string, CourseHealth>;
  focus: Focus;
  selection: Selection;
  query: string;
  onSelectPlan: (planId: string) => void;
  onNewPlan: () => void;
  onSetFocus: (focus: Focus) => void;
  onSelectCourse: (course: Course) => void;
  onNewCourse: () => void;
  onDeleteCourse: (course: Course) => void;
}) {
  const courses = plan?.courses ?? [];
  const behindCount = courses.filter((course) => isBehind(health.get(course.id))).length;
  const soonCount = courses.filter((course) => hasExamSoon(health.get(course.id))).length;
  const visible = courses.filter((course) => matchesQuery(query, course.name, course.code));

  return (
    <Sidebar label="Courses">
      <DropdownMenu
        label="Semester"
        align="start"
        items={[
          ...plans.map((candidate) => ({
            type: "checkbox" as const,
            label: candidate.name,
            checked: candidate.id === plan?.id,
            onSelect: () => onSelectPlan(candidate.id),
          })),
          ...(plans.length > 0 ? [{ type: "separator" as const }] : []),
          { label: "New semester…", icon: <Plus />, onSelect: onNewPlan },
        ]}
        trigger={
          <button
            type="button"
            className="flex h-7 w-full items-center gap-1.5 rounded-control px-2 text-left hover:bg-fill"
          >
            <span className="min-w-0 flex-1 truncate text-body font-semibold">
              {plan?.name ?? "No semester"}
            </span>
            <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-tertiary" />
          </button>
        }
      />

      <SidebarSection title="Focus">
        <SidebarItem
          label="All courses"
          icon={<Layers />}
          count={courses.length}
          selected={focus.kind === "all"}
          onSelect={() => onSetFocus({ kind: "all" })}
        />
        <SidebarItem
          label="Behind"
          icon={<AlertTriangle />}
          count={behindCount}
          selected={focus.kind === "behind"}
          onSelect={() => onSetFocus({ kind: "behind" })}
        />
        <SidebarItem
          label="Exams soon"
          icon={<CalendarClock />}
          count={soonCount}
          selected={focus.kind === "soon"}
          onSelect={() => onSetFocus({ kind: "soon" })}
        />
      </SidebarSection>

      <SidebarSection
        title="Courses"
        action={
          <Tooltip content="New course">
            <IconButton size="sm" label="New course" icon={<Plus />} onClick={onNewCourse} />
          </Tooltip>
        }
      >
        {visible.map((course) => {
          const courseHealth = health.get(course.id);
          const exam = courseHealth?.exam;

          return (
            <ContextMenu
              key={course.id}
              items={[
                {
                  label: `Delete ${course.name}`,
                  icon: <Trash2 />,
                  danger: true,
                  onSelect: () => onDeleteCourse(course),
                },
              ]}
            >
              {/* The row itself is the trigger, so right-clicking anywhere in
                  it opens the menu — including its padding, which is most of
                  its area. */}
              <SidebarItem
                label={course.name}
                dotColor={course.color}
                progress={courseProgress(course).ratio}
                selected={
                  focus.kind === "course" && focus.courseId === course.id
                    ? true
                    : selection?.kind === "course" && selection.id === course.id
                }
                badge={
                  exam && courseHealth?.daysUntilExam !== null ? (
                    <CountdownBadge
                      days={courseHealth.daysUntilExam}
                      provisional={exam.status === "provisional"}
                      atRisk={isBehind(courseHealth)}
                    />
                  ) : undefined
                }
                onSelect={() => onSelectCourse(course)}
              />
            </ContextMenu>
          );
        })}
      </SidebarSection>

      {courses.length > 0 && visible.length === 0 ? (
        <p className="px-2 text-callout text-tertiary">No course matches “{query.trim()}”.</p>
      ) : null}
    </Sidebar>
  );
}
