"use client";

/**
 * Arriving and leaving, when nobody knows the height in advance.
 *
 * `useRowTransitions` animates a list whose rows are all the same height, which
 * is what the timeline has. A course card is as tall as the topics inside it,
 * so its height has to be measured — and measured *again* whenever the card
 * changes, because a search that removes half a course's topics changes the
 * height of the thing being animated while it is animating.
 *
 * The two halves are ordered exactly as they are for fixed-height rows: a card
 * arriving grows to its height and then fades in; a card leaving fades out and
 * then collapses. Each half is half the shared duration, so a course filtered
 * out of the outline and a topic filtered out of the chart take the same time
 * and read as the same behaviour.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motionDuration, prefersReducedMotion } from "./motion";

/* ─── Which items are on screen, including the ones on their way off ────── */

export type Presence<T> = {
  key: string;
  item: T;
  present: boolean;
  /**
   * True for an item that has just joined a list that was already on screen.
   *
   * The list's *first* render is not an arrival — a view that animates every
   * one of its cards in when you switch to it is a splash screen — so this is
   * false for everything the list started with.
   */
  appear: boolean;
};

/**
 * The list, plus whatever has just left it.
 *
 * An element that has been unmounted cannot animate its own departure, so a
 * removed item stays in the returned list — marked `present: false`, carrying
 * the last value it had — for as long as its exit takes, and is dropped after.
 *
 * Structured exactly like `useRowTransitions`: keyed on the identity of the
 * array so a re-render that changed nothing costs nothing, and adjusted during
 * render so a departure is visible in the very commit that caused it.
 */
export function useListPresence<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly Presence<T>[] {
  const [rendered, setRendered] = useState<readonly Presence<T>[]>(() =>
    items.map((item) => ({ key: keyOf(item), item, present: true, appear: false })),
  );
  const order = items.map(keyOf).join("|");
  const [seen, setSeen] = useState<{ order: string; items: readonly T[] }>({ order, items });

  if (seen.items !== items) {
    setSeen({ order, items });
    setRendered((previous) =>
      seen.order === order ? refresh(previous, items, keyOf) : merge(previous, items, keyOf),
    );
  }

  // Whichever entries are on their way out, as a value an effect can be keyed
  // on. Dropping them is the one part of this that has to wait for the clock.
  const departing = rendered
    .filter((entry) => !entry.present)
    .map((entry) => entry.key)
    .join("|");

  useEffect(() => {
    if (departing === "") return;
    const timer = window.setTimeout(
      () => setRendered((entries) => entries.filter((entry) => entry.present)),
      motionDuration(document.documentElement),
    );
    return () => window.clearTimeout(timer);
  }, [departing]);

  return rendered;
}

/** The same entries, carrying whatever their items now say. Nothing arrives or leaves. */
function refresh<T>(
  previous: readonly Presence<T>[],
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly Presence<T>[] {
  const current = new Map(items.map((item) => [keyOf(item), item]));
  let changed = false;
  const next = previous.map((entry) => {
    const item = current.get(entry.key);
    if (!item || item === entry.item) return entry;
    changed = true;
    return { ...entry, item };
  });
  return changed ? next : previous;
}

function merge<T>(
  previous: readonly Presence<T>[],
  items: readonly T[],
  keyOf: (item: T) => string,
): Presence<T>[] {
  const instant = prefersReducedMotion();
  const before = new Map(previous.map((entry) => [entry.key, entry]));

  const entries: Presence<T>[] = items.map((item) => {
    const key = keyOf(item);
    const existing = before.get(key);
    // Back before it finished leaving: it still has its height, so it only has
    // to stop going.
    if (existing) return { ...existing, item, present: true, appear: false };
    return { key, item, present: true, appear: !instant };
  });

  if (instant) return entries;

  // Departing entries keep the place they had, so nothing below them moves
  // until their own collapse moves it.
  const keys = new Set(entries.map((entry) => entry.key));
  previous.forEach((entry, index) => {
    if (keys.has(entry.key)) return;
    entries.splice(Math.min(index, entries.length), 0, { ...entry, present: false });
  });

  return entries;
}

/* ─── One item, growing and collapsing ──────────────────────────────────── */

/**
 * The states a box passes through, in order.
 *
 * `enter` and `hold` exist only to give the browser a frame with the start
 * value in it: a height that is set and changed in the same commit is not a
 * transition, it is a cut with extra steps.
 */
type Phase = "open" | "enter" | "grow" | "hold" | "fade" | "closed";

/** Long enough that a visible tab always wins with a real frame. */
const FRAME_FALLBACK_MS = 100;

/**
 * Wraps content in a box that animates between nothing and whatever the
 * content measures.
 *
 * `appear` is what stops the whole outline animating itself in on every mount:
 * a card that was already there when the view rendered is simply there.
 */
export function Collapse({
  present,
  appear = false,
  className,
  children,
}: {
  present: boolean;
  /** Animate in on the first render as well as on later arrivals. */
  appear?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [phase, setPhase] = useState<Phase>(() => {
    if (!present) return "closed";
    return appear && !prefersReducedMotion() ? "enter" : "open";
  });

  /**
   * Measured at the moment a transition needs a number, and at no other time.
   *
   * This used to keep a `ResizeObserver` alive for the life of the box, on the
   * reasoning that reading the height at departure forces a layout in the frame
   * that can least afford one. That trade was badly wrong. An observer whose
   * callback sets state turns *every* layout change anywhere above it into a
   * re-render of this subtree — and the inspector's width animation resizes the
   * content column on every one of its frames. With a card per course and a box
   * per exam chip, one selection re-rendered the whole outline fifteen times
   * over. One forced read per transition is the cheaper side of that trade by
   * two orders of magnitude, and while the box is open it is at `height: auto`,
   * where the number is not used for anything at all.
   */
  useLayoutEffect(() => {
    if (phase === "open" || phase === "closed") return;
    const element = contentRef.current;
    if (element) setHeight(element.offsetHeight);
  }, [phase]);

  // Adjusted during render rather than in an effect: a box that has just been
  // filtered out must still be at its full height in the commit that removed
  // it, or there is no frame the collapse can start from. Bounded — it runs
  // once per genuine change of `present`.
  const [wasPresent, setWasPresent] = useState(present);
  if (wasPresent !== present) {
    setWasPresent(present);
    setPhase(
      prefersReducedMotion()
        ? present
          ? "open"
          : "closed"
        : present
          ? "enter"
          : "hold",
    );
  }

  useEffect(() => {
    if (phase === "open" || phase === "closed") return;

    if (phase === "enter" || phase === "hold") {
      const next = phase === "enter" ? "grow" : "fade";
      // Two frames, for the same reason the fixed-height rows need them: one
      // for React to commit the start value, one for the browser to take it.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setPhase(next));
      });
      // A tab that is not on screen is given no animation frames at all, and a
      // box stuck before its own entrance is a box that never appears — the
      // whole outline, blank, until something else happens to re-render it. The
      // clock is a worse start value than a frame and always fires, which is
      // the right trade for the difference between "slightly less smooth" and
      // "gone".
      const fallback = window.setTimeout(() => setPhase(next), FRAME_FALLBACK_MS);
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
        window.clearTimeout(fallback);
      };
    }

    const timer = window.setTimeout(
      () => setPhase(phase === "grow" ? "open" : "closed"),
      motionDuration(document.documentElement) / 2,
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  return (
    <div
      className={`collapse-motion ${className ?? ""}`}
      aria-hidden={present ? undefined : "true"}
      inert={present ? undefined : true}
      style={{
        // `auto` once it is open, so a card that grows a row taller follows its
        // contents without needing an animation of its own.
        height: phase === "open" ? undefined : phase === "grow" || phase === "hold" || phase === "fade" ? height : 0,
        opacity: phase === "open" || phase === "hold" ? 1 : 0,
      }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
