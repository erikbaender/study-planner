"use client";

/**
 * Arriving and leaving, when nobody knows the height in advance.
 *
 * `useRowTransitions` animates a list whose rows are all the same height, which
 * is what the timeline's topic rows are. A course card is whatever its topics
 * make it, so the height it grows to and collapses from has to be measured —
 * but the *motion* is the same motion, in the same two stages on the same
 * clock, driven by the same phases:
 *
 * - **Arriving:** the space opens first, then the card fades into it.
 * - **Leaving:** the card fades out first, then the space it took closes.
 *
 * This used to be an opacity fade with no height at all, on the theory that
 * animating several variable-height cards at once would hitch. It does not:
 * the measurement happens once per phase change rather than per frame, and
 * every frame after it is one interpolated height on a clipped box. What the
 * fade-only version actually cost was the whole point of the motion — the
 * cards around the one being filtered jumped into their new places, so the
 * fade said something had left without ever saying what had moved.
 */

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useRowPhases, type PhasedRow, type RowPhase } from "./row-motion";

/* ─── Which items are on screen, including the ones on their way off ────── */

/** An item on screen, and how far through its arrival or departure it is. */
export type Presence<T> = PhasedRow<T>;

/**
 * The list, plus whatever has just left it for the duration of its departure.
 *
 * An element that has been unmounted cannot animate its own departure, so a
 * removed item stays in the returned list — carrying the last value it had —
 * for as long as its fade and collapse take, and is dropped after. The list's
 * *first* render is not an arrival: a view that animates every one of its
 * cards in when you switch to it is a splash screen, so everything the list
 * started with begins at `shown`.
 */
export function useListPresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly Presence<T>[] {
  return useRowPhases(items, keyOf);
}

/* ─── The box that opens and closes ─────────────────────────────────────── */

/** Heights are only ever set on the two phases that animate between them. */
function heightFor(phase: RowPhase, content: HTMLElement | null): string {
  if (phase === "shown") return "";
  if (phase === "enter" || phase === "shrink") return "0px";
  // `grow` and `fade` are the ends of the two travels: the height the card is
  // growing to, and the height it is about to collapse from. Both are what the
  // content measures right now, which under `grow` is its natural height even
  // though the box around it is currently zero.
  return `${content?.getBoundingClientRect().height ?? 0}px`;
}

/**
 * Wraps content in a box that animates between nothing and whatever the
 * content measures.
 *
 * The height is written to the DOM from a layout effect rather than rendered:
 * it cannot be known until the content is in the document, and a state update
 * to carry it back into the tree would cost a second render of the card on
 * every phase. At rest the box has no height of its own at all, so a course
 * unfolding inside it is still the card's own motion rather than something
 * this has to be told about.
 */
export function Collapse({
  phase,
  className,
  children,
}: {
  phase: RowPhase;
  /**
   * Applied to the *measured* box, so a list's gap belongs here rather than on
   * the container: a gap between flex items survives the item collapsing to
   * nothing, and the space would go in one frame when the card unmounted.
   */
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const leaving = phase === "fade" || phase === "shrink";
  const visible = phase === "shown";

  useLayoutEffect(() => {
    const element = box.current;
    if (element) element.style.height = heightFor(phase, content.current);
  }, [phase]);

  return (
    <div
      ref={box}
      className={`collapse-motion ${visible ? "opacity-100" : "opacity-0"}`}
      data-visible={visible ? "true" : "false"}
      data-phase={phase}
      aria-hidden={leaving ? "true" : undefined}
      inert={leaving ? true : undefined}
    >
      <div ref={content} className={className}>
        {children}
      </div>
    </div>
  );
}
