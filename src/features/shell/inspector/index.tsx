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
 * Two rules it holds to:
 *
 * - **Progress is never written here directly.** Dragging the progress bar
 *   files a study-log entry for the difference, exactly as the outline row
 *   does. Setting `completedUnits` through `updateTopic` would move the number
 *   while leaving velocity and the pace projection with nothing to measure —
 *   the app would then report a pace derived from work it has no record of.
 * - **A selection that no longer resolves shows nothing.** The panel is handed
 *   an already-resolved selection, so a deleted topic empties it rather than
 *   describing whatever now occupies that position.
 */

import { clsx } from "clsx";
import type { CourseHealth } from "@/domain";
import type { ResolvedSelection } from "@/features/workspace/scope";
import { CourseInspector } from "./course-inspector";
import { ExamInspector } from "./exam-inspector";
import { TopicInspector } from "./topic-inspector";

export function Inspector({
  selection,
  health,
  today,
  onDelete,
}: {
  selection: ResolvedSelection;
  health: Map<string, CourseHealth>;
  today: string;
  onDelete: (selection: NonNullable<ResolvedSelection>) => void;
}) {
  return (
    <aside
      aria-label="Inspector"
      className={clsx(
        "material-sidebar flex w-72 shrink-0 flex-col overflow-y-auto",
        "border-l border-separator",
      )}
    >
      {selection === null ? (
        <p className="px-4 py-6 text-body text-secondary">
          Nothing selected. Choose Show in inspector from a course’s actions menu, or select a
          topic or exam in the outline.
        </p>
      ) : selection.kind === "course" ? (
        <CourseInspector
          course={selection.course}
          health={health.get(selection.course.id)}
          onDelete={() => onDelete(selection)}
        />
      ) : selection.kind === "topic" ? (
        <TopicInspector
          course={selection.course}
          topic={selection.topic}
          today={today}
          onDelete={() => onDelete(selection)}
        />
      ) : (
        <ExamInspector
          course={selection.course}
          exam={selection.exam}
          onDelete={() => onDelete(selection)}
        />
      )}
    </aside>
  );
}


