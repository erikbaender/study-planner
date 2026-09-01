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

import { clsx } from "clsx";
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

/** A list of one, so a single thing can arrive and leave on the same clock. */
const PRESENT: readonly { id: string }[] = [{ id: "present" }];
const ABSENT: readonly { id: string }[] = [];
const presenceKey = (item: { id: string }) => item.id;

/**
 * One thing, coming and going.
 *
 * A toolbar that only makes sense when there is something to sort, an empty
 * state, a card that exists only while a course is behind: each is a list of
 * at most one, and running it through the same machine is what keeps it on the
 * same clock as the rows it appears alongside. `null` once it has finished
 * leaving — and, on the first render, if it was never there.
 */
export function usePresence(present: boolean): RowPhase | null {
  const rows = useRowPhases(present ? PRESENT : ABSENT, presenceKey);
  return rows[0]?.phase ?? null;
}

/* ─── The box that opens and closes ─────────────────────────────────────── */

/**
 * The measured phases, and only those.
 *
 * `grow` and `fade` are the ends of the two travels: the height the card is
 * growing to, and the height it is about to collapse from. Both are what the
 * content measures right now, which under `grow` is its natural height even
 * though the box around it is currently zero. Every other phase is a constant
 * — 0px, 0px, and the card's own height — and needs no measurement at all.
 */
function measures(phase: RowPhase): boolean {
  return phase === "grow" || phase === "fade";
}

function heightFor(phase: RowPhase, content: HTMLElement | null): string {
  if (phase === "shown") return "";
  if (phase === "enter" || phase === "shrink") return "0px";
  return `${content?.getBoundingClientRect().height ?? 0}px`;
}

/* ─── One layout for a whole list, however long it is ───────────────────── */

/**
 * A card that has to measure itself queues the work instead of doing it.
 *
 * Filtering the sidebar down to nothing changes every card's phase in one
 * commit, and each card would read its content's height and then write that
 * height to its own box. Card by card, that is read, write, read, write — and
 * each write invalidates the layout the next read needs, so a list of seven
 * cards costs the browser seven full layouts of the outline, or seven of the
 * whole timeline canvas, inside a single frame. That is the hitch, and it
 * arrives exactly when the most cards are moving at once.
 *
 * The queue is drained in a microtask, which still runs before the browser
 * paints: every read happens first and every write after, which is one layout
 * for the list however long it is. Only the two measured phases queue —
 * heights that are constants stay where they are decided, so a card being
 * mounted at zero or collapsed to zero is still written synchronously.
 */
type Measurement = { box: HTMLElement; content: HTMLElement | null; phase: RowPhase };

const queued: Measurement[] = [];
let scheduled = false;

function flushMeasurements(): void {
  scheduled = false;
  const pending = queued.splice(0);
  const heights = pending.map(({ phase, content }) => heightFor(phase, content));
  pending.forEach((measurement, index) => {
    measurement.box.style.height = heights[index];
  });
}

function measure(measurement: Measurement): void {
  // A second phase change on the same box in the same commit replaces the
  // first: only the last one is worth writing.
  const existing = queued.findIndex((pending) => pending.box === measurement.box);
  if (existing === -1) queued.push(measurement);
  else queued[existing] = measurement;

  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flushMeasurements);
}

/** A box that has gone back to a constant height must not be written by a stale read. */
function cancelMeasurement(box: HTMLElement): void {
  const existing = queued.findIndex((pending) => pending.box === box);
  if (existing !== -1) queued.splice(existing, 1);
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
  as: Box = "div",
  className,
  boxClassName,
  children,
}: {
  phase: RowPhase;
  /** The element the box itself is, for a list that wants real list items. */
  as?: "div" | "li";
  /**
   * Applied to the *measured* box, so a list's gap belongs here rather than on
   * the container: a gap between flex items survives the item collapsing to
   * nothing, and the space would go in one frame when the card unmounted.
   */
  className?: string;
  /** Applied to the collapsing box, for the rare caller whose parent lays it out. */
  boxClassName?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const leaving = phase === "fade" || phase === "shrink";
  const visible = phase === "shown";

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    if (measures(phase)) {
      measure({ box: element, content: content.current, phase });
      return;
    }
    cancelMeasurement(element);
    element.style.height = heightFor(phase, content.current);
  }, [phase]);

  return (
    <Box
      ref={box as never}
      className={clsx("collapse-motion", visible ? "opacity-100" : "opacity-0", boxClassName)}
      data-visible={visible ? "true" : "false"}
      data-phase={phase}
      aria-hidden={leaving ? "true" : undefined}
      inert={leaving ? true : undefined}
    >
      <div ref={content} className={className}>
        {children}
      </div>
    </Box>
  );
}

/* ─── The same clock, without the room ──────────────────────────────────── */

/**
 * One surface handing over to another.
 *
 * A view whose focus has just been emptied does not open a space for the
 * message that says so — the message goes where the content was. So the two
 * overlap, and the only thing that moves is opacity: the content leaves over
 * the first half of the shared duration and the message arrives over the
 * second, which is the same order and the same clock a card's fade-then-close
 * runs on. Driven by the same phases so it cannot drift from them: `grow` is
 * the half the outgoing surface owns, `shown` the half this one does.
 */
export function Fade({
  phase,
  className,
  children,
}: {
  phase: RowPhase;
  className?: string;
  children: ReactNode;
}) {
  const leaving = phase === "fade" || phase === "shrink";
  const visible = phase === "shown";

  return (
    <div
      className={clsx("presence-fade", visible ? "opacity-100" : "opacity-0", className)}
      data-visible={visible ? "true" : "false"}
      data-phase={phase}
      aria-hidden={leaving ? "true" : undefined}
      inert={leaving ? true : undefined}
    >
      {children}
    </div>
  );
}

/**
 * The counterpart: the surface being handed *over*, told by the arriving one's
 * phase whether it is still the one on screen.
 *
 * `null` is nothing arriving, and `shrink` is the second half of an arrival
 * being undone — the half in which the content comes back.
 */
export function isHandedOver(phase: RowPhase | null): boolean {
  return phase !== null && phase !== "shrink";
}
