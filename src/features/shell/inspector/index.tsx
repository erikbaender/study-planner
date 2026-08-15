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
import { useEffect, useState } from "react";
import { motionDuration, prefersReducedMotion } from "@/ui/motion";
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
  const [shown, setShown] = useState(selection);
  const [fade, setFade] = useState<"steady" | "out" | "in">("steady");
  const selectionKey = selection ? `${selection.kind}:${selectionId(selection)}` : null;
  const shownKey = shown ? `${shown.kind}:${selectionId(shown)}` : null;
  const reducedMotion = prefersReducedMotion();

  // Keep the old inspector mounted until its complete 500ms fade-out is done.
  // The next content then gets its own 500ms fade-in: together they make one
  // uninterrupted, one-second sequence with no two panels fighting for paint.
  if (shown === null && selection !== null && fade === "steady") {
    setShown(selection);
    setFade(reducedMotion ? "steady" : "in");
  } else if (selectionKey !== shownKey && fade !== "out" && !(shown === null && selection === null)) {
    if (reducedMotion) {
      setShown(selection);
      setFade("steady");
    } else {
      setFade("out");
    }
  }
  if (selectionKey === shownKey && selection !== shown && fade === "steady") setShown(selection);

  useEffect(() => {
    if (fade !== "out") return;
    const timer = window.setTimeout(() => {
      setShown(selection);
      setFade(selection === null ? "steady" : "in");
    }, motionDuration(document.documentElement, "--inspector-fade-duration") / 2);
    return () => window.clearTimeout(timer);
  }, [fade, selection]);

  useEffect(() => {
    if (fade !== "in") return;
    const timer = window.setTimeout(
      () => setFade("steady"),
      motionDuration(document.documentElement, "--inspector-fade-duration") / 2,
    );
    return () => window.clearTimeout(timer);
  }, [fade]);

  return (
    <aside
      aria-label="Inspector"
      data-keeps-selection
      className={clsx(
        "material-sidebar flex w-72 shrink-0 flex-col overflow-y-auto",
        "border-l border-separator",
      )}
    >
      {shown === null ? null : (
        <div
          key={`${shown.kind}:${selectionId(shown)}`}
          className="inspector-content"
          data-inspector-fade={fade === "out" ? "out" : fade === "in" ? "in" : undefined}
        >
          {shown.kind === "course" ? (
            <CourseInspector course={shown.course} onDelete={() => onDelete(shown)} />
          ) : shown.kind === "topic" ? (
            <TopicInspector
              course={shown.course}
              courses={courses.length > 0 ? courses : [shown.course]}
              topic={shown.topic}
              today={today}
              onRevealBlock={onRevealBlock}
              onDelete={() => onDelete(shown)}
            />
          ) : (
            <ExamInspector
              course={shown.course}
              exam={shown.exam}
              onDelete={() => onDelete(shown)}
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
