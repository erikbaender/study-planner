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
 * **It has no switch.** It used to have one, in the toolbar, and that produced
 * two states nothing in the app could explain: a panel open with nothing in it,
 * and a panel closed while a row elsewhere was plainly highlighted as selected.
 * The panel is now a function of the selection — present when something is
 * selected, gone when nothing is — and every view opens it by selecting into it.
 *
 * Three rules it holds to:
 *
 * - **Progress is never written here directly.** Dragging the progress bar
 *   files a study-log entry for the difference, exactly as the outline row
 *   does. Setting `completedUnits` through `updateTopic` would move the number
 *   while leaving velocity and the pace projection with nothing to measure —
 *   the app would then report a pace derived from work it has no record of.
 * - **A selection that no longer resolves shows nothing.** The panel is handed
 *   an already-resolved selection, so a deleted topic empties it rather than
 *   describing whatever now occupies that position.
 * - **Every panel lists its children.** Semester → courses → topics → blocks,
 *   as rows that select one level down, with the breadcrumb as the way back up.
 *   The panel is how you walk the plan, not merely how you edit one end of it.
 */

import { clsx } from "clsx";
import { useState } from "react";
import type { CourseHealth } from "@/domain";
import type { ResolvedSelection } from "@/features/workspace/scope";
import type { Selection } from "@/features/workspace/store";
import { BlockInspector } from "./block-inspector";
import { CourseInspector } from "./course-inspector";
import { ExamInspector } from "./exam-inspector";
import { PlanInspector } from "./plan-inspector";
import { TopicInspector } from "./topic-inspector";
import { Breadcrumb, type BreadcrumbStep } from "./shared";

export type InspectorProps = {
  selection: ResolvedSelection;
  health: Map<string, CourseHealth>;
  today: string;
  onSelect: (selection: Selection) => void;
  onDelete: (selection: NonNullable<Selection>) => void;
};

/**
 * Keep describing the last thing while the panel leaves.
 *
 * The shell collapses the column the moment the selection clears, and that
 * collapse is an animation — so for its whole length there is a visible panel
 * with nothing to put in it. Retaining the last resolved selection means what
 * slides out is what was there, rather than a blank column that appears for a
 * quarter of a second every time you deselect.
 */
function useRetained(selection: ResolvedSelection): ResolvedSelection {
  const [retained, setRetained] = useState(selection);
  if (selection !== null && selection !== retained) setRetained(selection);
  return selection ?? retained;
}

export function Inspector(props: InspectorProps) {
  const selection = useRetained(props.selection);

  return (
    <aside
      aria-label="Inspector"
      className={clsx(
        "material-sidebar flex w-72 shrink-0 flex-col overflow-y-auto",
        "border-l border-separator",
      )}
    >
      {selection === null ? null : (
        <>
          <Breadcrumb trail={trailFor(selection, props.onSelect)} />
          {/* Keyed on the selection, so replacing one panel with another is a
              crossfade on the shared curve rather than a cut. Two panels of the
              same kind still swap: the id is part of the key. */}
          <div key={`${selection.kind}:${idOf(selection)}`} className="inspector-panel flex flex-col">
            <Panel {...props} selection={selection} />
          </div>
        </>
      )}
    </aside>
  );
}

function Panel({
  selection,
  health,
  today,
  onSelect,
  onDelete,
}: InspectorProps & { selection: NonNullable<ResolvedSelection> }) {
  switch (selection.kind) {
    case "plan":
      return <PlanInspector plan={selection.plan} onSelect={onSelect} onDelete={onDelete} />;
    case "course":
      return (
        <CourseInspector
          course={selection.course}
          health={health.get(selection.course.id)}
          today={today}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      );
    case "topic":
      return (
        <TopicInspector
          course={selection.course}
          topic={selection.topic}
          today={today}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      );
    case "exam":
      return (
        <ExamInspector
          course={selection.course}
          exam={selection.exam}
          onDelete={() => onDelete({ kind: "exam", id: selection.exam.id })}
        />
      );
    case "block":
      return (
        <BlockInspector
          course={selection.course}
          topic={selection.topic}
          block={selection.block}
          today={today}
          onSelect={onSelect}
        />
      );
  }
}

function idOf(selection: NonNullable<ResolvedSelection>): string {
  switch (selection.kind) {
    case "plan":
      return selection.plan.id;
    case "course":
      return selection.course.id;
    case "topic":
      return selection.topic.id;
    case "exam":
      return selection.exam.id;
    case "block":
      return selection.block.id;
  }
}

/** The ancestry of the current selection, outermost first. */
function trailFor(
  selection: NonNullable<ResolvedSelection>,
  onSelect: (selection: Selection) => void,
): BreadcrumbStep[] {
  const step = (id: string, label: string, kind: NonNullable<Selection>["kind"]): BreadcrumbStep => ({
    id,
    label,
    select: () => onSelect({ kind, id }),
  });

  const trail = [step(selection.plan.id, selection.plan.name, "plan")];
  if (selection.kind === "plan") return trail;

  trail.push(step(selection.course.id, selection.course.name, "course"));
  if (selection.kind === "course") return trail;
  if (selection.kind === "exam") return [...trail, step(selection.exam.id, selection.exam.name, "exam")];

  trail.push(step(selection.topic.id, selection.topic.name, "topic"));
  if (selection.kind === "topic") return trail;

  return [...trail, step(selection.block.id, selection.block.startDate, "block")];
}
