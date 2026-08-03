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

import {
  AlertTriangle,
  CalendarClock,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Layers,
  Plus,
} from "lucide-react";
import { clsx } from "clsx";
import type { CSSProperties } from "react";
import type { Course, CourseHealth, Plan } from "@/domain";
import { courseProgress } from "@/domain";
import {
  CountdownBadge,
  DropdownMenu,
  IconButton,
  ProgressBar,
  Sidebar,
  SidebarItem,
  SidebarSection,
  Tooltip,
} from "@/ui";
import {
  hasExamSoon,
  isBehind,
  matchesQuery,
  sortCoursesAlphabetically,
} from "@/features/workspace/scope";
import type { Focus } from "@/features/workspace/store";

export function AppSidebar({
  plans,
  plan,
  health,
  focus,
  hiddenCourseIds,
  query,
  onSelectPlan,
  onNewPlan,
  onEditPlan,
  onDeletePlan,
  onSetFocus,
  onToggleHidden,
  onHideAll,
  onShowAll,
  onNewCourse,
}: {
  plans: readonly Plan[];
  plan: Plan | undefined;
  health: Map<string, CourseHealth>;
  focus: Focus;
  hiddenCourseIds: readonly string[];
  query: string;
  onSelectPlan: (planId: string) => void;
  onNewPlan: () => void;
  onEditPlan: () => void;
  onDeletePlan: () => void;
  onSetFocus: (focus: Focus) => void;
  onToggleHidden: (course: Course) => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onNewCourse: () => void;
}) {
  const courses = plan?.courses ?? [];
  const behindCount = courses.filter((course) => isBehind(health.get(course.id))).length;
  const soonCount = courses.filter((course) => hasExamSoon(health.get(course.id))).length;
  const visible = sortCoursesAlphabetically(
    courses.filter((course) => matchesQuery(query, course.name, course.code)),
  );

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
          ...(plan
            ? [
                { label: "Edit semester…", onSelect: onEditPlan },
                { label: "Delete semester…", danger: true, onSelect: onDeletePlan },
              ]
            : []),
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
          <span className="flex items-center gap-0.5">
            <Tooltip content="Show every course">
              <IconButton size="sm" label="Show every course" icon={<Eye />} onClick={onShowAll} />
            </Tooltip>
            <Tooltip content="Hide every course">
              <IconButton size="sm" label="Hide every course" icon={<EyeOff />} onClick={onHideAll} />
            </Tooltip>
            <Tooltip content="New course">
              <IconButton size="sm" label="New course" icon={<Plus />} onClick={onNewCourse} />
            </Tooltip>
          </span>
        }
      >
        {visible.map((course) => (
          <CourseFilterRow
            key={course.id}
            course={course}
            health={health.get(course.id)}
            hidden={hiddenCourseIds.includes(course.id)}
            onToggleHidden={() => onToggleHidden(course)}
          />
        ))}
      </SidebarSection>

      {courses.length > 0 && visible.length === 0 ? (
        <p className="px-2 text-callout text-tertiary">No course matches “{query.trim()}”.</p>
      ) : null}
    </Sidebar>
  );
}

/**
 * A course in the source list.
 *
 * Not a selectable row. Selecting a course here used to narrow every view to
 * it, which made the sidebar a navigation control that also filtered — two jobs
 * competing in one click. It is now purely a filter, with the two switches that
 * filtering actually needs:
 *
 * **Hide** removes the course from all three views. Its icon describes the
 * action it will take, matching the global show-all and hide-all controls.
 *
 * The course's own details live in the inspector, reached from the outline or
 * from ⌘K — where they belong, since that is a question about one course rather
 * than about what you are looking at.
 */
function CourseFilterRow({
  course,
  health,
  hidden,
  onToggleHidden,
}: {
  course: Course;
  health: CourseHealth | undefined;
  hidden: boolean;
  onToggleHidden: () => void;
}) {
  const off = hidden;
  const completed =
    course.topics.length > 0 &&
    course.topics.every((topic) => topic.totalUnits > 0 && topic.completedUnits >= topic.totalUnits);

  return (
    <li
      data-course-id={course.id}
      data-course-completed={completed ? "true" : undefined}
      className="course-completion-row group/row flex flex-col gap-1 rounded-control px-2 py-1 hover:bg-fill"
      style={{ "--topic-completion-color": course.color } as CSSProperties}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={clsx("size-2.5 shrink-0 rounded-full", off && "opacity-40")}
          style={{ background: course.color }}
        />
        <span className={clsx("min-w-0 flex-1 truncate text-body", off && "text-tertiary")}>
          {course.name}
        </span>

        {/* The countdown never swaps out. The action grows into the row on its
            right, which naturally pushes the countdown left while keeping the
            button anchored. This single layout has no competing hover layers
            for Chromium or Radix focus to leave stale after a state update. */}
        <span className="flex shrink-0 items-center justify-end gap-0.5">
          {health?.exam && health.daysUntilExam !== null ? (
            <span className={clsx("shrink-0", hidden && "opacity-40")}>
              <CountdownBadge
                days={health.daysUntilExam}
                provisional={health.exam.status === "provisional"}
                atRisk={isBehind(health)}
              />
            </span>
          ) : null}

          <span className="flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-[width,opacity] duration-100 ease-mac pointer-events-none group-hover/row:w-control group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:w-control group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto">
            <Tooltip content={hidden ? "Show this course" : "Hide this course"}>
              <IconButton
                size="sm"
                label={hidden ? `Show ${course.name}` : `Hide ${course.name}`}
                icon={hidden ? <Eye /> : <EyeOff />}
                // A pointer click gives the button DOM focus. If it keeps that
                // focus, the keyboard-only `focus-within` reveal survives long
                // after the pointer leaves this row. Pointer users already
                // have hover; keyboard activation does not fire pointer-up and
                // therefore keeps the action visible as intended.
                onPointerUp={(event) => event.currentTarget.blur()}
                onClick={onToggleHidden}
              />
            </Tooltip>
          </span>
        </span>
      </span>

      <ProgressBar
        ratio={courseProgress(course).ratio}
        label={`${course.name} progress`}
        size="sm"
        tint={course.color}
        className={off ? "opacity-40" : undefined}
      />
    </li>
  );
}
