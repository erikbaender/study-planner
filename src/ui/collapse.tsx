"use client";

/**
 * Arriving and leaving, when nobody knows the height in advance.
 *
 * `useRowTransitions` animates a list whose rows are all the same height, which
 * is what the timeline has. Course cards are variable-height, but their filter
 * animation is deliberately only an opacity fade: animating several cards'
 * heights at once forces repeated layout passes and reads as a hitch.
 */

import { useEffect, useState, type ReactNode } from "react";
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
  const instant = prefersReducedMotion();
  const [visible, setVisible] = useState(present && (!appear || instant));
  const [seenPresent, setSeenPresent] = useState(present);

  // A departure must render its opacity endpoint in the same commit that
  // changed presence. Arrivals remain transparent until the effect below has
  // given the browser a frame in which to paint that starting point.
  if (seenPresent !== present) {
    setSeenPresent(present);
    if (!present) setVisible(false);
    else if (instant) setVisible(true);
  }

  /**
   * Filtering can add several variable-height cards at once. Give an arriving
   * card two frames at opacity zero before revealing it, mirroring disclosure
   * motion and preventing React's commit from skipping the fade's first frame.
   */
  useEffect(() => {
    if (!present || visible || instant) return;

    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setVisible(true));
    });
    const fallback = window.setTimeout(() => setVisible(true), 100);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      window.clearTimeout(fallback);
    };
  }, [instant, present, visible]);

  return (
    <div
      className={`collapse-motion ${visible ? "opacity-100" : "opacity-0"} ${className ?? ""}`}
      data-visible={visible ? "true" : "false"}
      aria-hidden={present ? undefined : "true"}
      inert={present ? undefined : true}
    >
      {children}
    </div>
  );
}
