/**
 * What a topic's bars mean when there is more than one of them.
 *
 * Two rules live here, and both only bite once a topic is scheduled across
 * several windows — which is the normal case for anything bigger than an
 * afternoon:
 *
 * - **Progress is one quantity, spread over the bars.** Drawing each bar at the
 *   topic's overall ratio said "40% of this window is done" four times over for
 *   a topic that is 40% done in total, which reads as four times the work.
 *   Filling the earliest bars first and running out partway through one of them
 *   is the honest picture: the filled length across the row *is* the progress.
 * - **Bars of one topic do not overlap.** Two windows covering the same days are
 *   not a plan, and the spread above would draw them as if they were sequential
 *   anyway. Drags are clamped to the gap between neighbours rather than
 *   rejected, so a drag that goes too far stops against the next bar.
 */

import {
  addDays,
  differenceInDays,
  maxDate,
  minDate,
  topicProgress,
  type EntityId,
  type IsoDate,
  type StudyBlock,
  type Topic,
} from "@/domain";

export type Span = { startDate: IsoDate; endDate: IsoDate };

/** How the topic's completed work divides between its bars, as a 0–1 fill each. */
export function fillsByBlock(topic: Topic): Map<EntityId, number> {
  const fills = new Map<EntityId, number>();
  const ordered = inOrder(topic.blocks);
  if (ordered.length === 0) return fills;

  const weights = weightsOf(ordered);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  // An untracked topic has no ratio at all — no size, so nothing to divide.
  let remaining = (topicProgress(topic).ratio ?? 0) * total;

  ordered.forEach((block, index) => {
    const weight = weights[index];
    const taken = Math.max(0, Math.min(remaining, weight));
    fills.set(block.id, weight > 0 ? taken / weight : 0);
    remaining -= taken;
  });
  return fills;
}

/**
 * How much of the topic each bar is expected to carry.
 *
 * The scheduler's own intent when it recorded one, and the bar's length when it
 * did not — a hand-drawn week is a fair guess at twice a hand-drawn half-week.
 * Mixed sets fall back to length wholesale rather than comparing units against
 * days, which would be a number in neither unit.
 */
function weightsOf(blocks: readonly StudyBlock[]): number[] {
  const planned = blocks.every((block) => (block.plannedUnits ?? 0) > 0);
  if (planned) return blocks.map((block) => block.plannedUnits ?? 0);
  return blocks.map((block) => differenceInDays(block.startDate, block.endDate) + 1);
}

/** Chronological, with a stable tiebreak so equal starts do not reorder between renders. */
function inOrder(blocks: readonly StudyBlock[]): StudyBlock[] {
  return [...blocks].sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id),
  );
}

/** The days a bar may occupy: `null` at an end means nothing is in the way there. */
export type Limits = { earliest: IsoDate | null; latest: IsoDate | null };

/**
 * The free run around a span, given everything else on the row.
 *
 * Neighbours that already overlap the span are ignored: they are pre-existing
 * data, and clamping against them would pin a bar where it stands rather than
 * letting it be dragged out of the overlap.
 */
export function limitsAround(span: Span, others: readonly StudyBlock[]): Limits {
  let earliest: IsoDate | null = null;
  let latest: IsoDate | null = null;

  for (const other of others) {
    if (other.endDate < span.startDate) {
      earliest = earliest ? maxDate(earliest, other.endDate) : other.endDate;
    } else if (other.startDate > span.endDate) {
      latest = latest ? minDate(latest, other.startDate) : other.startDate;
    }
  }

  return {
    earliest: earliest ? addDays(earliest, 1) : null,
    latest: latest ? addDays(latest, -1) : null,
  };
}

/** The free run around a bar, given the topic it belongs to. */
export function limitsFor(block: StudyBlock, topic: Topic): Limits {
  return limitsAround(
    block,
    topic.blocks.filter((other) => other.id !== block.id),
  );
}

/**
 * A dragged span, held inside its gap.
 *
 * A move keeps its length and stops against whichever neighbour it reaches; a
 * resize only ever moves the edge being dragged. When a gap is narrower than
 * the bar — only reachable from data that already overlapped — the start wins,
 * because a bar pinned to its earlier neighbour is still draggable rightwards.
 */
export function clampToLimits(span: Span, mode: "move" | "start" | "end", limits: Limits): Span {
  if (mode === "start") {
    return {
      startDate: limits.earliest ? maxDate(span.startDate, limits.earliest) : span.startDate,
      endDate: span.endDate,
    };
  }
  if (mode === "end") {
    return {
      startDate: span.startDate,
      endDate: limits.latest ? minDate(span.endDate, limits.latest) : span.endDate,
    };
  }

  const length = differenceInDays(span.startDate, span.endDate);
  let startDate = span.startDate;
  if (limits.latest && addDays(startDate, length) > limits.latest) {
    startDate = addDays(limits.latest, -length);
  }
  if (limits.earliest && startDate < limits.earliest) startDate = limits.earliest;
  return { startDate, endDate: addDays(startDate, length) };
}
