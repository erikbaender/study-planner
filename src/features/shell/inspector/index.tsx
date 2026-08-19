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
 * - **It describes what was selected last, even on the way out.** The panel
 *   holds the previous selection while it fades away, so a deselect is a panel
 *   leaving rather than a panel emptying and then leaving. The fade runs on the
 *   app's shared duration and is interruptible in both directions: a second
 *   click during it is answered from wherever the first one had got to.
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
import { useEffect, useRef, useState } from "react";
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
  const [fade, setFade] = useState<"steady" | "out">("steady");
  const selectionKey = selection ? `${selection.kind}:${selectionId(selection)}` : null;
  const shownKey = shown ? `${shown.kind}:${selectionId(shown)}` : null;
  const reducedMotion = prefersReducedMotion();
  // What to show when the fade-out ends, read at the moment it ends. A click
  // during the fade must not restart it: the clock belongs to the content
  // leaving, not to the selection that replaces it.
  const latestSelection = useRef(selection);
  useEffect(() => {
    latestSelection.current = selection;
  });

  // Only the leaving half is a phase here. Arriving content mounts transparent
  // and is faded in by CSS, so the panel has one piece of state rather than a
  // two-step sequence to be caught halfway through. Adjusted during render, so
  // the fade begins in the commit the click caused rather than a frame later.
  if (shown === null) {
    // Nothing to take away first.
    if (selection !== null) setShown(selection);
  } else if (selectionKey === shownKey) {
    // Reselecting what is already here. If it was on its way out — clicked
    // away from and back again inside a fade — it turns around from the
    // opacity it reached instead of finishing a departure nobody asked for.
    if (fade === "out") setFade("steady");
    if (selection !== shown) setShown(selection);
  } else if (fade !== "out") {
    if (reducedMotion) setShown(selection);
    else setFade("out");
  }
  // A change while `fade` is already `out` needs nothing: the content on screen
  // is leaving either way, and the swap below picks up whatever is selected by
  // the time it lands.

  useEffect(() => {
    if (fade !== "out") return;
    const timer = window.setTimeout(() => {
      setShown(latestSelection.current);
      setFade("steady");
    }, motionDuration(document.documentElement) / 2);
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
          data-inspector-fade={fade === "out" ? "out" : undefined}
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
