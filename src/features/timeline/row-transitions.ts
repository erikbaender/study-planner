import { useLayoutEffect, useRef } from "react";
import { motionCurveValue, motionDuration, prefersReducedMotion } from "@/ui/motion";
import { useRowTransitions as useSharedRowTransitions } from "@/ui/row-motion";
import { ROW_HEIGHT } from "./layout";

/**
 * The chart's rows and disclosures are the app's, at the chart's row height.
 * The motion itself lives in `@/ui/row-motion` so the outline opens a course
 * exactly as the timeline does; only `useReorderAnimation` below is the
 * chart's own, because only the chart sorts rows under a drag.
 */
export { useDisclosure } from "@/ui/row-motion";
export type { RowMotion } from "@/ui/row-motion";

export function useRowTransitions<T>(items: readonly T[], keyOf: (item: T) => string) {
  return useSharedRowTransitions(items, keyOf, ROW_HEIGHT);
}

/**
 * Two rows trading places.
 *
 * The combined lane is sorted by where each topic's work *starts*, so dragging
 * a block past a neighbour's first day reorders the list under the drag. That
 * was a cut: the row you were holding and the one it passed swapped in a single
 * frame, and the only way to know which two had moved was to have been watching
 * the right part of the screen.
 *
 * This is FLIP, with the "first" read for free. Every row in this lane is
 * exactly `ROW_HEIGHT` tall, so a row's old position is its old *index* — no
 * measuring, no forced layout, and nothing that costs anything on the renders
 * where the order did not change. Each moved row is put back where it was with
 * a transform, and that transform is released on the shared curve; the label in
 * the gutter carries the same `data-row-key` and is moved by the same loop, so
 * both halves of the row travel together.
 */
export function useReorderAnimation(keys: readonly string[]) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<readonly string[]>(keys);
  // Renders are frequent and reorders are not, and `keys` is a fresh array on
  // every one of them. The effect is keyed on the order *as a string*, so it
  // does nothing at all on the renders where nothing swapped — and `keys`
  // itself is read from the closure, which is the array from precisely the
  // render that changed it.
  const order = keys.join("|");

  useLayoutEffect(() => {
    const container = ref.current;
    const was = previous.current;
    const now = keys;
    previous.current = now;
    if (!container || prefersReducedMotion()) return;

    // Rank only rows present in both snapshots. Filtering one out already moves
    // the rows below it through the collapsing height; treating that index shift
    // as a reorder applies a second transform animation. Only genuine swaps
    // should receive FLIP.
    const current = new Set(now);
    const common = new Set(was.filter((key) => current.has(key)));
    const rank = (keys: readonly string[]) => {
      const ranks = new Map<string, number>();
      let position = 0;
      for (const key of keys) if (common.has(key)) ranks.set(key, position++);
      return ranks;
    };
    const from = rank(was);
    const to = rank(now);
    const moved = now
      .map((key) => ({ key, by: (from.get(key) ?? 0) - (to.get(key) ?? 0) }))
      .filter(({ key, by }) => by !== 0 && to.has(key));
    if (moved.length === 0) return;

    const rows = moved.flatMap(({ key, by }) =>
      Array.from(
        container.querySelectorAll<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`),
        (element) => ({ element, by }),
      ),
    );
    if (rows.length === 0) return;

    for (const { element, by } of rows) {
      element.style.transition = "none";
      element.style.transform = `translateY(${by * ROW_HEIGHT}px)`;
    }
    // Read, so the browser takes the offsets above as the transition's start
    // rather than collapsing both writes into no change at all.
    void container.offsetWidth;

    const duration = motionDuration(container);
    for (const { element } of rows) {
      element.style.transition = `transform ${duration}ms ${motionCurveValue(container)}`;
      element.style.transform = "";
    }

    const settle = window.setTimeout(() => {
      for (const { element } of rows) element.style.transition = "";
    }, duration);
    return () => {
      window.clearTimeout(settle);
      for (const { element } of rows) {
        element.style.transition = "";
        element.style.transform = "";
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  return ref;
}
