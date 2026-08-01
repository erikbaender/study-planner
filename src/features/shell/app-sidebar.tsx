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
  Focus as FocusIcon,
  Layers,
  Plus,
} from "lucide-react";
import { clsx } from "clsx";
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
import { hasExamSoon, isBehind, matchesQuery } from "@/features/workspace/scope";
import type { Focus } from "@/features/workspace/store";

export function AppSidebar({
  plans,
  plan,
  health,
  focus,
  hiddenCourseIds,
  isolatedCourseId,
  query,
  onSelectPlan,
  onNewPlan,
  onSetFocus,
  onToggleHidden,
  onToggleIsolated,
  onHideAll,
  onShowAll,
  onNewCourse,
}: {
  plans: readonly Plan[];
  plan: Plan | undefined;
  health: Map<string, CourseHealth>;
  focus: Focus;
  hiddenCourseIds: readonly string[];
  isolatedCourseId: string | null;
  query: string;
  onSelectPlan: (planId: string) => void;
  onNewPlan: () => void;
  onSetFocus: (focus: Focus) => void;
  onToggleHidden: (course: Course) => void;
  onToggleIsolated: (course: Course) => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onNewCourse: () => void;
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
            isolated={isolatedCourseId === course.id}
            dimmed={isolatedCourseId !== null && isolatedCourseId !== course.id}
            onToggleHidden={() => onToggleHidden(course)}
            onToggleIsolated={() => onToggleIsolated(course)}
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
 * - **hide** removes the course from all three views;
 * - **isolate** shows only that course, overriding both the hidden list and the
 *   focus. One at a time, because isolating two things is just hiding the rest.
 *
 * The course's own details live in the inspector, reached from the outline or
 * from ⌘K — where they belong, since that is a question about one course rather
 * than about what you are looking at.
 */
function CourseFilterRow({
  course,
  health,
  hidden,
  isolated,
  dimmed,
  onToggleHidden,
  onToggleIsolated,
}: {
  course: Course;
  health: CourseHealth | undefined;
  hidden: boolean;
  isolated: boolean;
  /** Something else is isolated, so this row is out of scope without being hidden. */
  dimmed: boolean;
  onToggleHidden: () => void;
  onToggleIsolated: () => void;
}) {
  const off = hidden || dimmed;

  return (
    <li className="group/row flex flex-col gap-1 rounded-control px-2 py-1 hover:bg-fill">
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={clsx("size-2.5 shrink-0 rounded-full", off && "opacity-40")}
          style={{ background: course.color }}
        />
        <span className={clsx("min-w-0 flex-1 truncate text-body", off && "text-tertiary")}>
          {course.name}
        </span>

        {/* The switches sit where the countdown does and trade places with it on
            hover, rather than taking a permanent column: at rest the row should
            read as a course, not as a control panel. */}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
          <Tooltip content={isolated ? "Stop isolating" : "Show only this course"}>
            <IconButton
              size="sm"
              label={isolated ? `Stop isolating ${course.name}` : `Show only ${course.name}`}
              aria-pressed={isolated}
              icon={<FocusIcon />}
              className={isolated ? "text-accent" : undefined}
              onClick={onToggleIsolated}
            />
          </Tooltip>
          <Tooltip content={hidden ? "Show this course" : "Hide this course"}>
            <IconButton
              size="sm"
              label={hidden ? `Show ${course.name}` : `Hide ${course.name}`}
              aria-pressed={hidden}
              icon={hidden ? <EyeOff /> : <Eye />}
              onClick={onToggleHidden}
            />
          </Tooltip>
        </span>

        <span className="shrink-0 group-hover/row:hidden">
          {isolated ? (
            <FocusIcon aria-hidden="true" className="size-3.5 text-accent" />
          ) : hidden ? (
            <EyeOff aria-label={`${course.name} is hidden`} className="size-3.5 text-tertiary" />
          ) : health?.exam && health.daysUntilExam !== null ? (
            <CountdownBadge
              days={health.daysUntilExam}
              provisional={health.exam.status === "provisional"}
              atRisk={isBehind(health)}
            />
          ) : null}
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
