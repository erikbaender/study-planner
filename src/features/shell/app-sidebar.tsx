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
  Search,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import type { CSSProperties, RefObject } from "react";
import type { Course, CourseHealth, IsoDate, Plan } from "@/domain";
import { courseColorValue, courseProgress } from "@/domain";
import {
  CountdownBadge,
  DropdownMenu,
  IconButton,
  ProgressBar,
  Sidebar,
  SidebarItem,
  SidebarSection,
} from "@/ui";
import {
  hasExamSoon,
  isBehind,
  needsAttention,
  sortCoursesAlphabetically,
} from "@/features/workspace/scope";
import type { Focus } from "@/features/workspace/store";

export function AppSidebar({
  plans,
  plan,
  health,
  today,
  focus,
  hiddenCourseIds,
  query,
  searchRef,
  selectedCourseId,
  onSelectPlan,
  onNewPlan,
  onEditPlan,
  onDeletePlan,
  onSetFocus,
  onSetQuery,
  onSelectCourse,
  onToggleHidden,
  onHideAll,
  onShowAll,
  onNewCourse,
}: {
  plans: readonly Plan[];
  plan: Plan | undefined;
  health: Map<string, CourseHealth>;
  today: IsoDate;
  focus: Focus;
  hiddenCourseIds: readonly string[];
  query: string;
  searchRef?: RefObject<HTMLInputElement | null>;
  selectedCourseId: string | null;
  onSelectPlan: (planId: string) => void;
  onNewPlan: () => void;
  onEditPlan: () => void;
  onDeletePlan: () => void;
  onSetFocus: (focus: Focus) => void;
  onSetQuery?: (query: string) => void;
  onSelectCourse: (course: Course) => void;
  onToggleHidden: (course: Course) => void;
  onHideAll: () => void;
  onShowAll: () => void;
  onNewCourse: () => void;
}) {
  const courses = plan?.courses ?? [];
  const attentionCount = courses.filter((course) => needsAttention(course, health.get(course.id), today)).length;
  const soonCount = courses.filter((course) => hasExamSoon(health.get(course.id))).length;
  const visible = sortCoursesAlphabetically(courses);

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

      <SidebarSection title="Search">
        <div className="group flex h-control items-center gap-1 rounded-control border border-transparent bg-fill px-1.5 text-tertiary transition-colors duration-100 ease-mac focus-within:border-accent focus-within:bg-content focus-within:text-accent">
          <Search aria-hidden="true" className="size-3.5 shrink-0" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search courses and topics"
            value={query}
            onChange={(event) => onSetQuery?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onSetQuery?.("");
            }}
            className="min-w-0 flex-1 bg-transparent text-center text-body text-label outline-none focus:outline-none focus:ring-0 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSetQuery?.("")}
              className="flex size-4 shrink-0 items-center justify-center rounded-full text-current transition-colors hover:bg-fill-strong group-focus-within:hover:bg-accent-soft"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          ) : null}
        </div>
      </SidebarSection>

      <SidebarSection title="Focus">
        <SidebarItem
          label="All courses"
          icon={<Layers />}
          count={courses.length}
          selected={focus.kind === "all"}
          onSelect={() => onSetFocus({ kind: "all" })}
        />
        <SidebarItem
          label="Attention needed"
          icon={<AlertTriangle />}
          count={attentionCount}
          selected={focus.kind === "attention"}
          onSelect={() => onSetFocus({ kind: "attention" })}
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
            <IconButton
              size="sm"
              label="Show every course"
              icon={<Eye />}
              onClick={onShowAll}
            />
            <IconButton
              size="sm"
              label="Hide every course"
              icon={<EyeOff />}
              onClick={onHideAll}
            />
            <IconButton
              size="sm"
              label="New course"
              icon={<Plus />}
              onClick={onNewCourse}
            />
          </span>
        }
      >
        {visible.map((course) => (
          <CourseFilterRow
            key={course.id}
            course={course}
            health={health.get(course.id)}
            hidden={hiddenCourseIds.includes(course.id)}
            selected={selectedCourseId === course.id}
            onSelect={() => onSelectCourse(course)}
            onToggleHidden={() => onToggleHidden(course)}
          />
        ))}
      </SidebarSection>

    </Sidebar>
  );
}

/**
 * A course in the source list.
 *
 * A course row selects the course for inspection; its eye control remains the
 * separate filter action. Keeping those two actions distinct means a click on
 * the name does not unexpectedly hide every other course:
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
  selected,
  onSelect,
  onToggleHidden,
}: {
  course: Course;
  health: CourseHealth | undefined;
  hidden: boolean;
  selected: boolean;
  onSelect: () => void;
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
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      className={clsx(
        "course-completion-row group/row flex cursor-default flex-col gap-1 rounded-control px-2 py-1 hover:bg-fill",
        selected && "bg-accent-soft text-label hover:bg-accent-soft",
      )}
      style={{ "--topic-completion-color": courseColorValue(course.color) } as CSSProperties}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className={clsx("size-2.5 shrink-0 rounded-full", off && "opacity-40")}
          style={{ background: courseColorValue(course.color) }}
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
                onTrack={health.pace?.onTrack ?? false}
              />
            </span>
          ) : null}

          <span className="flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-[width,opacity] duration-100 ease-mac pointer-events-none group-hover/row:w-control group-hover/row:opacity-100 group-hover/row:pointer-events-auto group-focus-within/row:w-control group-focus-within/row:opacity-100 group-focus-within/row:pointer-events-auto">
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
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleHidden();
                }}
              />
          </span>
        </span>
      </span>

      <ProgressBar
        ratio={courseProgress(course).ratio}
        label={`${course.name} progress`}
        size="sm"
        tint={courseColorValue(course.color)}
        className={off ? "opacity-40" : undefined}
      />
    </li>
  );
}
