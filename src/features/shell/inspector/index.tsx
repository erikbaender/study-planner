"use client";

/**
 * The inspector.
 *
 * This panel is what replaces the modal-per-click pattern the audit found: the
 * old app opened a full-screen dialog for every detail, including for clicks
 * that were meant to be drags. An inspector shows the same fields without
 * taking the document away, so you can edit a topic while still seeing where it
 * sits among the others.
 *
 * Three rules it holds to:
 *
 * - **It is a function of the selection.** There is no switch for it any more.
 *   Selecting something shows the panel; deselecting hides it. A panel that
 *   could be open with nothing in it needed an empty state to explain itself,
 *   and an empty state in a third of the window is the app apologising for its
 *   own layout.
 * - **It describes what was selected last, even on the way out.** The shell
 *   keeps handing it the previous selection while the panel slides away, so a
 *   deselect is a panel leaving rather than a panel emptying and then leaving.
 * - **Progress is never written here directly.** Dragging the progress bar
 *   files a study-log entry for the difference, exactly as an outline row does.
 *   Setting `completedUnits` through `updateTopic` would move the number while
 *   leaving velocity and the pace projection with nothing to measure — the app
 *   would then report a pace derived from work it has no record of.
 */

import { clsx } from "clsx";
import { usePlannerState } from "@/data/use-repository";
import type { Course, CourseHealth, StudyBlock, Topic } from "@/domain";
import type { ResolvedSelection } from "@/features/workspace/scope";
import { CourseInspector } from "./course-inspector";
import { ExamInspector } from "./exam-inspector";
import { TopicInspector } from "./topic-inspector";

export function Inspector({
  selection,
  health,
  today,
  onSelectCourse,
  onSelectTopic,
  onRevealBlock,
  onDelete,
  courses: suppliedCourses,
}: {
  /** Whatever was selected last — it stays here while the panel animates away. */
  selection: NonNullable<ResolvedSelection> | null;
  health: Map<string, CourseHealth>;
  today: string;
  onSelectCourse: (course: Course) => void;
  onSelectTopic: (course: Course, topic: Topic) => void;
  onRevealBlock: (block: StudyBlock) => void;
  onDelete: (selection: NonNullable<ResolvedSelection>) => void;
  /** Optional injection keeps the panel's rendering tests independent of storage. */
  courses?: readonly Course[];
}) {
  const repositoryState = usePlannerState();
  const planCourses =
    repositoryState.status === "ready"
      ? (repositoryState.snapshot.plans.find((plan) => plan.id === selection?.course.planId)?.courses ?? [])
      : [];
  const courses = suppliedCourses ?? planCourses;

  return (
    <aside
      aria-label="Inspector"
      data-keeps-selection
      className={clsx(
        "material-sidebar flex w-72 shrink-0 flex-col overflow-y-auto",
        "border-l border-separator",
      )}
    >
      {selection === null ? null : (
        // Keyed on what is being described, so switching from one topic to
        // another fades the new contents in rather than swapping the text under
        // a panel that never moved.
        <div key={`${selection.kind}:${selectionId(selection)}`} className="inspector-content">
          {selection.kind === "course" ? (
            <CourseInspector
              course={selection.course}
              health={health.get(selection.course.id)}
              selectedId={null}
              onSelectTopic={(topic) => onSelectTopic(selection.course, topic)}
              onDelete={() => onDelete(selection)}
            />
          ) : selection.kind === "topic" ? (
            <TopicInspector
              course={selection.course}
              courses={courses.length > 0 ? courses : [selection.course]}
              topic={selection.topic}
              today={today}
              onRevealBlock={onRevealBlock}
              onDelete={() => onDelete(selection)}
            />
          ) : (
            <ExamInspector
              course={selection.course}
              exam={selection.exam}
              onSelectCourse={() => onSelectCourse(selection.course)}
              onDelete={() => onDelete(selection)}
            />
          )}
        </div>
      )}
    </aside>
  );
}

function selectionId(selection: NonNullable<ResolvedSelection>): string {
  return selection.kind === "course"
    ? selection.course.id
    : selection.kind === "topic"
      ? selection.topic.id
      : selection.exam.id;
}
