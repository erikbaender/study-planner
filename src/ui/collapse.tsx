"use client";

/**
 * Arriving and leaving, when nobody knows the height in advance.
 *
 * `useRowTransitions` animates a list whose rows are all the same height, which
 * is what the timeline has. Course cards are variable-height, but their filter
 * animation is deliberately only an opacity fade: animating several cards'
 * heights at once forces repeated layout passes and reads as a hitch.
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
 * The list, plus whatever has just left it for the duration of its fade.
 *
 * An element that has been unmounted cannot animate its own departure, so a
 * removed item stays in the returned list — marked `present: false`, carrying
 * the last value it had — for as long as its opacity transition takes, and is
 * dropped after.
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
  const boxRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const previousPresentRef = useRef(present);

  /**
   * Filtering can add or remove several variable-height cards at once. Keep
   * the animation on the element itself so React only reconciles the list
   * once, while the browser runs the shared opacity transition.
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    let frame = 0;
    const instant = prefersReducedMotion();
    const firstRender = !mountedRef.current;
    const leaving = !firstRender && previousPresentRef.current && !present;
    mountedRef.current = true;
    previousPresentRef.current = present;

    const clear = () => {
      cancelAnimationFrame(frame);
    };

    if (instant || (firstRender && !appear)) {
      box.style.opacity = present ? "1" : "0";
      return clear;
    }

    if (present) {
      // A returning card may be part-way through its departure. Let the
      // transition continue from its current opacity rather than restarting a
      // height measurement or a React phase machine.
      box.style.opacity = "0";
      void box.offsetHeight;
      frame = requestAnimationFrame(() => {
        box.style.opacity = "1";
      });
    } else if (leaving) {
      // Keep the card in the list's natural flow until presence removes it;
      // only its pixels fade. This avoids a second layout animation fighting
      // the filter's list reconciliation.
      box.style.opacity = "1";
      void box.offsetHeight;
      frame = requestAnimationFrame(() => {
        box.style.opacity = "0";
      });
    } else {
      box.style.opacity = "0";
    }

    return clear;
  }, [appear, present]);

  return (
    <div
      ref={boxRef}
      className={`collapse-motion ${className ?? ""}`}
      aria-hidden={present ? undefined : "true"}
      inert={present ? undefined : true}
      style={{ opacity: present ? 1 : 0 }}
    >
      {children}
    </div>
  );
}
