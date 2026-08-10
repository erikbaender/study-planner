/**
 * Dragging a selection, not a bar.
 *
 * Once several bars move together the clamp cannot be per-bar any more. If each
 * one stopped where its own neighbour is, a selection dragged into a crowded
 * week would arrive spread differently from how it left: the bar that ran out of
 * room first would sit still while the others carried on past it, and the
 * relative shape of the work — the thing the selection was made to preserve —
 * would be quietly rewritten.
 *
 * So the gesture is one number. Every selected bar contributes the range of days
 * *it* could travel, the drag is clamped to the intersection of all of them, and
 * the same delta is applied to every bar. The first bar to reach a neighbour, or
 * the first to reach its minimum length, stops the whole gesture — which is what
 * "they move together" has to mean.
 *
 * Pure, and separate from the view for the same reason `geometry.ts` is: this is
 * where the off-by-one lives.
 */

import { addDays, differenceInDays, type EntityId, type StudyBlock, type Topic } from "@/domain";
import { limitsAround, type Span } from "./blocks";

export type DragMode = "move" | "start" | "end";

/** A bar in a drag: the block itself and the topic whose other blocks bound it. */
export type BarTarget = { block: StudyBlock; topic: Topic };

export type DeltaRange = { min: number; max: number };

export function applyDelta(mode: DragMode, span: Span, days: number): Span {
  if (mode === "move") {
    return { startDate: addDays(span.startDate, days), endDate: addDays(span.endDate, days) };
  }
  if (mode === "start") {
    return { startDate: addDays(span.startDate, days), endDate: span.endDate };
  }
  return { startDate: span.startDate, endDate: addDays(span.endDate, days) };
}

/**
 * The days one bar may travel, given the blocks it may not cross.
 *
 * A resize is also bounded by the bar itself: an edge dragged past the opposite
 * one is not a shorter block, it is a broken one, so both stop at a single day.
 */
export function rangeFor(
  mode: DragMode,
  block: StudyBlock,
  blocked: readonly StudyBlock[],
): DeltaRange {
  const limits = limitsAround(block, blocked);
  const earliest = limits.earliest
    ? differenceInDays(block.startDate, limits.earliest)
    : -Infinity;
  const latest = limits.latest ? differenceInDays(block.endDate, limits.latest) : Infinity;

  if (mode === "move") return { min: earliest, max: latest };
  if (mode === "start") return { min: earliest, max: differenceInDays(block.startDate, block.endDate) };
  return { min: differenceInDays(block.endDate, block.startDate), max: latest };
}

/**
 * The intersection of every selected bar's range.
 *
 * Bars in the same topic that are *both* selected do not bound each other: they
 * are travelling together and the gap between them is not changing.
 */
export function groupRange(
  mode: DragMode,
  targets: readonly BarTarget[],
  selected: ReadonlySet<EntityId>,
): DeltaRange {
  let min = -Infinity;
  let max = Infinity;

  for (const { block, topic } of targets) {
    const blocked = topic.blocks.filter(
      (other) => other.id !== block.id && !selected.has(other.id),
    );
    const range = rangeFor(mode, block, blocked);
    min = Math.max(min, range.min);
    max = Math.min(max, range.max);
  }

  return { min, max };
}

export function clampDelta(range: DeltaRange, days: number): number {
  return Math.min(Math.max(days, range.min), range.max);
}
