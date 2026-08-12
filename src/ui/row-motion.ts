"use client";

/**
 * Rows and disclosures, arriving and leaving.
 *
 * These began in the timeline and now belong to the whole app: the outline
 * opens courses and filters topics for exactly the same reasons the chart does,
 * and two implementations of the same motion would drift apart within a week.
 * Everything here reads `--topic-motion-duration` off the document, so a
 * disclosure in the outline and one in the timeline are the same length by
 * construction rather than by coincidence.
 *
 * Callers must pass an `items` array that is a prop or memoized. The merge
 * below is keyed on that array's *identity* and adjusts state during render; a
 * fresh array built inline on every render is an infinite loop.
 */

import { useEffect, useMemo, useState } from "react";
import { motionDuration, prefersReducedMotion } from "./motion";

/**
 * Open and closed, with the frames in between.
 *
 * A course opening used to be a cut: forty rows existed or they did not. The
 * two states are the same information at two densities, so the honest motion is
 * a height, and a height needs both ends of it to exist. Rows stay mounted for
 * the whole of a close so there is something to shrink, and are unmounted after
 * it so a closed course of forty topics costs nothing to have. Opening needs
 * the mirror image: they have to exist at zero height for a frame before the
 * height they are growing to is applied, or the browser has no start value and
 * the growth is the cut again.
 */
export function useDisclosure(open: boolean): { mounted: boolean; expanded: boolean } {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);

  // Both halves of the toggle that are not animations happen during render:
  // rows have to exist before they can grow, and a close has to start
  // collapsing on the click rather than a frame after it.
  if (open && !mounted) setMounted(true);
  if (!open && expanded) setExpanded(false);

  useEffect(() => {
    if (open) {
      // Two frames: one for React to commit the rows at zero height, one for
      // the browser to take that as the transition's start value. The timeout
      // is the fallback for a tab that is not on screen and therefore gets no
      // frames at all: a disclosure stuck before its own opening never opens.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setExpanded(true));
      });
      const fallback = window.setTimeout(() => setExpanded(true), 100);
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
        window.clearTimeout(fallback);
      };
    }

    const timer = window.setTimeout(
      () => setMounted(false),
      motionDuration(document.documentElement),
    );
    return () => window.clearTimeout(timer);
  }, [open]);

  return { mounted, expanded };
}

/* ─── Rows arriving and leaving ─────────────────────────────────────────────
 *
 * Filtering in the sidebar takes rows out of a view and puts them back, and
 * both used to be cuts: the height of the group animated — so the view made
 * room, visibly — while the label and the contents inside that room appeared and
 * vanished in a single frame. Worse in the arriving direction, because the text
 * was there in full before the space for it was, which reads as the text landing
 * first and the row catching up.
 *
 * So the two halves are ordered rather than simultaneous, and the order is the
 * one the eye expects of anything physical:
 *
 * - **Arriving:** the row grows to its height first, then its contents fade in.
 * - **Leaving:** the contents fade out first, then the row collapses.
 *
 * Each half is half of the shared motion duration on the shared curve, so a
 * filter change costs exactly as long as one disclosure does, and reversing it
 * is the mirror image. Rows stay mounted for the whole of a departure, because
 * an element that has left the DOM cannot animate anything.
 * ────────────────────────────────────────────────────────────────────────── */

type RowPhase = "enter" | "grow" | "shown" | "fade" | "shrink";

/** What a row looks like right now: how much room it takes, and whether it is drawn. */
export type RowMotion = { height: number; visible: boolean };

/**
 * One object per state *per height* rather than one per render: a row is
 * memoized on its props, and a fresh `{height, visible}` every time would either
 * re-render every row on every render or — comparing by identity — never
 * re-render the one that actually moved.
 */
const motionCache = new Map<number, Record<"collapsed" | "silent" | "shown", RowMotion>>();

function motionsFor(rowHeight: number) {
  const cached = motionCache.get(rowHeight);
  if (cached) return cached;
  const created = {
    collapsed: { height: 0, visible: false },
    silent: { height: rowHeight, visible: false },
    shown: { height: rowHeight, visible: true },
  };
  motionCache.set(rowHeight, created);
  return created;
}

function motionOf(phase: RowPhase, rowHeight: number): RowMotion {
  const motions = motionsFor(rowHeight);
  if (phase === "enter" || phase === "shrink") return motions.collapsed;
  return phase === "shown" ? motions.shown : motions.silent;
}

type RenderedRow<T> = { key: string; item: T; phase: RowPhase };

function mergeRows<T>(
  previous: readonly RenderedRow<T>[],
  items: readonly T[],
  keyOf: (item: T) => string,
): RenderedRow<T>[] {
  const instant = prefersReducedMotion();
  const before = new Map(previous.map((row) => [row.key, row]));
  const keys = new Set(items.map(keyOf));

  const rows: RenderedRow<T>[] = items.map((item) => {
    const key = keyOf(item);
    const existing = before.get(key);
    if (!existing) return { key, item, phase: instant ? "shown" : "enter" };
    // A row that was on its way out and has been filtered back in: it still has
    // its height, so it only has to fade back.
    if (existing.phase === "fade") return { key, item, phase: "shown" };
    if (existing.phase === "shrink") return { key, item, phase: instant ? "shown" : "enter" };
    return { ...existing, item };
  });

  if (instant) return rows;

  // Leaving rows keep the place they had, so nothing below them moves until
  // their own collapse moves it.
  previous.forEach((row, index) => {
    if (keys.has(row.key)) return;
    const leaving: RenderedRow<T> =
      row.phase === "fade" || row.phase === "shrink" ? row : { ...row, phase: "fade" };
    rows.splice(Math.min(index, rows.length), 0, leaving);
  });

  return rows;
}

/** The same rows, carrying whatever their items now say. Nothing arrives or leaves. */
function refreshRows<T>(
  previous: readonly RenderedRow<T>[],
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly RenderedRow<T>[] {
  const current = new Map(items.map((item) => [keyOf(item), item]));
  let changed = false;
  const next = previous.map((row) => {
    const item = current.get(row.key);
    if (!item || item === row.item) return row;
    changed = true;
    return { ...row, item };
  });
  return changed ? next : previous;
}

export function useRowTransitions<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  rowHeight: number,
): readonly { key: string; item: T; motion: RowMotion }[] {
  const [rendered, setRendered] = useState<readonly RenderedRow<T>[]>(() =>
    items.map((item) => ({ key: keyOf(item), item, phase: "shown" as RowPhase })),
  );

  // Adjusted during render rather than in an effect, the way the disclosure
  // above is: a row that has just been filtered in has to exist at zero height
  // in the very commit that added it, or there is no frame in which the browser
  // can take that as the start of its growth.
  //
  // Keyed on the list's identity, and only *reordered* when the keys changed:
  // the view re-renders whenever anything in it moves, and `items` may be a
  // fresh array every time.
  const order = items.map(keyOf).join("|");
  const [seen, setSeen] = useState<{ order: string; items: readonly T[] }>({ order, items });
  if (seen.items !== items) {
    setSeen({ order, items });
    setRendered((previous) =>
      seen.order === order ? refreshRows(previous, items, keyOf) : mergeRows(previous, items, keyOf),
    );
  }

  const phases = rendered.map((row) => row.phase).join("");
  useEffect(() => {
    if (rendered.every((row) => row.phase === "shown")) return;
    let frame = 0;
    let inner = 0;
    let timer = 0;

    if (rendered.some((row) => row.phase === "enter")) {
      // Two frames, for the same reason `useDisclosure` needs them: the row has
      // to exist at zero height before the height it grows to is applied, or
      // the browser has no start value and the growth is a cut again.
      frame = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() =>
          setRendered((rows) =>
            rows.map((row) => (row.phase === "enter" ? { ...row, phase: "grow" } : row)),
          ),
        );
      });
    }

    if (rendered.some((row) => row.phase !== "shown" && row.phase !== "enter")) {
      timer = window.setTimeout(
        () =>
          setRendered((rows) =>
            rows.flatMap((row) => {
              if (row.phase === "grow") return [{ ...row, phase: "shown" as RowPhase }];
              if (row.phase === "fade") return [{ ...row, phase: "shrink" as RowPhase }];
              if (row.phase === "shrink") return [];
              return [row];
            }),
          ),
        motionDuration(document.documentElement) / 2,
      );
    }

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(inner);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phases]);

  return useMemo(
    () => rendered.map(({ key, item, phase }) => ({ key, item, motion: motionOf(phase, rowHeight) })),
    [rendered, rowHeight],
  );
}
