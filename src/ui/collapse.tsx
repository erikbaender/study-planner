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
  const contentRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const previousPresentRef = useRef(present);

  /**
   * Filtering can add or remove several variable-height cards at once. The
   * old phase machine stored every animation step in React state, so each
   * frame re-rendered the complete outline and made all of the cards measure
   * again. The list still owns presence, but the short-lived height/opacity
   * values belong to the element that is actually moving.
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;

    let frame = 0;
    let settle = 0;
    const duration = motionDuration(box);
    const instant = prefersReducedMotion();
    const firstRender = !mountedRef.current;
    const entering = firstRender ? appear : !previousPresentRef.current && present;
    const leaving = !firstRender && previousPresentRef.current && !present;
    mountedRef.current = true;
    previousPresentRef.current = present;

    const clear = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };

    if (instant || (firstRender && !appear)) {
      box.style.height = present ? "auto" : "0px";
      box.style.opacity = present ? "1" : "0";
      return clear;
    }

    const fullHeight = content.offsetHeight;

    if (present) {
      // A returning card may be part-way through its departure. Starting from
      // its current rendered height keeps a quick filter reversal continuous.
      const currentHeight = entering ? 0 : Math.max(0, box.getBoundingClientRect().height);
      box.style.height = `${currentHeight}px`;
      box.style.opacity = "0";
      void box.offsetHeight;
      frame = requestAnimationFrame(() => {
        box.style.height = `${fullHeight}px`;
        box.style.opacity = "1";
        settle = window.setTimeout(() => {
          box.style.height = "auto";
        }, duration / 2);
      });
    } else if (leaving) {
      // Capture the full content before collapsing. The next frame starts the
      // fade, then the second half collapses the space it occupied.
      box.style.height = `${fullHeight}px`;
      box.style.opacity = "1";
      void box.offsetHeight;
      frame = requestAnimationFrame(() => {
        box.style.opacity = "0";
        settle = window.setTimeout(() => {
          box.style.height = "0px";
        }, duration / 2);
      });
    } else {
      box.style.height = "0px";
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
      style={{ height: present ? undefined : 0, opacity: present ? 1 : 0 }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
