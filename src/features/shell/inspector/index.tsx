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
 * - **It describes whatever is selected, and only that.** Course, topic or
 *   exam — one object, its own properties, no summary of the objects inside
 *   it. The course panel is the New course sheet's four fields and nothing
 *   more; the topics and exams it contains are in the card beside it, listed
 *   with their own progress and their own actions.
 */

import { clsx } from "clsx";
import { usePlannerState } from "@/data/use-repository";
import type { Course, StudyBlock } from "@/domain";
import type { ResolvedSelection } from "@/features/workspace/scope";
import { CourseInspector } from "./course-inspector";
import { ExamInspector } from "./exam-inspector";
import { TopicInspector } from "./topic-inspector";

/** The kinds of selection that open the panel — which is all of them. */
export type InspectableSelection = NonNullable<ResolvedSelection>;

/** Whether a resolved selection is something the inspector can describe. */
export function isInspectable(
  selection: ResolvedSelection | null,
): selection is InspectableSelection {
  return selection !== null && selection !== undefined;
}

export function Inspector({
  selection,
  today,
  onRevealBlock,
  onDelete,
  courses: suppliedCourses,
}: {
  /** Whatever was selected last — it stays here while the panel animates away. */
  selection: InspectableSelection | null;
  today: string;
  onRevealBlock: (block: StudyBlock) => void;
  onDelete: (selection: InspectableSelection) => void;
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
            <CourseInspector course={selection.course} onDelete={() => onDelete(selection)} />
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
              onDelete={() => onDelete(selection)}
            />
          )}
        </div>
      )}
    </aside>
  );
}

function selectionId(selection: InspectableSelection): string {
  return selection.kind === "course"
    ? selection.course.id
    : selection.kind === "topic"
      ? selection.topic.id
      : selection.exam.id;
}
