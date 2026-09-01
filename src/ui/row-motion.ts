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

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { motionCurveValue, motionDuration, prefersReducedMotion } from "./motion";

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
/* ─── One clock, not one per list ───────────────────────────────────────── */

/**
 * The moment a stage ends, shared by everything that ends with it.
 *
 * Today draws four lists, and filtering a course changes all four at once. Each
 * had its own timer, so each woke the app up by itself: four separate tasks,
 * four separate renders of the view, and — because a render of a whole view in
 * a development build is not free — the fourth list started collapsing sixty
 * milliseconds after the first. Measured at 480ms, the two halves of the same
 * motion had visibly come apart, and the same is true of a course card, its
 * exam rows and its topic rows all leaving together.
 *
 * So the deadline is the unit rather than the caller. Anything that asks for
 * the same instant is woken by the same timer, in one task, which React commits
 * once — the lists move together because there is nothing left that could move
 * them apart.
 */
type Tick = { at: number; run: Set<() => void>; timer: number };

const ticks: Tick[] = [];

/**
 * A few milliseconds of slack, because the effects that schedule these run one
 * after another rather than at the same instant. Far shorter than any stage,
 * so two deadlines that mean different moments can never be merged.
 */
const TICK_TOLERANCE_MS = 8;

function advanceTogether(delay: number, run: () => void): () => void {
  const at = Date.now() + delay;
  let tick = ticks.find((candidate) => Math.abs(candidate.at - at) <= TICK_TOLERANCE_MS);
  if (!tick) {
    const created: Tick = { at, run: new Set(), timer: 0 };
    created.timer = window.setTimeout(() => {
      drop(created);
      // Copied, because a callback may schedule the next stage as it runs.
      for (const callback of [...created.run]) callback();
    }, delay);
    ticks.push(created);
    tick = created;
  }
  const joined = tick;
  joined.run.add(run);

  return () => {
    joined.run.delete(run);
    if (joined.run.size > 0) return;
    window.clearTimeout(joined.timer);
    drop(joined);
  };
}

function drop(tick: Tick): void {
  const index = ticks.indexOf(tick);
  if (index !== -1) ticks.splice(index, 1);
}

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

    // Shared, so folding every course in the outline unmounts them all in one
    // commit rather than seven.
    return advanceTogether(motionDuration(document.documentElement), () => setMounted(false));
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

/**
 * Where a row is in its arrival or its departure.
 *
 * Exported because the same five states drive the variable-height version of
 * this motion in `./collapse`: a course card grows before it fades in and
 * fades out before it collapses for exactly the reason a topic row does, and
 * the two would drift apart if each owned its own state machine.
 */
export type RowPhase = "enter" | "grow" | "shown" | "fade" | "shrink";

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

/** A row, and how much of its arrival or departure has happened. */
export type PhasedRow<T> = { key: string; item: T; phase: RowPhase };

function mergeRows<T>(
  previous: readonly PhasedRow<T>[],
  items: readonly T[],
  keyOf: (item: T) => string,
): PhasedRow<T>[] {
  const instant = prefersReducedMotion();
  const before = new Map(previous.map((row) => [row.key, row]));
  const keys = new Set(items.map(keyOf));

  const rows: PhasedRow<T>[] = items.map((item) => {
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
    const leaving: PhasedRow<T> =
      row.phase === "fade" || row.phase === "shrink" ? row : { ...row, phase: "fade" };
    rows.splice(Math.min(index, rows.length), 0, leaving);
  });

  return rows;
}

/** The same rows, carrying whatever their items now say. Nothing arrives or leaves. */
function refreshRows<T>(
  previous: readonly PhasedRow<T>[],
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly PhasedRow<T>[] {
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

/**
 * The list, each entry carrying how far through its arrival or departure it is.
 *
 * The state machine only — no heights, because the two callers measure them
 * differently: a topic row is `ROW_HEIGHT` and knows it in advance, and a
 * course card is whatever its topics make it and has to be measured. Both
 * still change phase on the same clock, so a filter change is one motion
 * wherever it lands.
 */
export function useRowPhases<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): readonly PhasedRow<T>[] {
  const [rendered, setRendered] = useState<readonly PhasedRow<T>[]>(() =>
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

  const arriving = rendered.some((row) => row.phase === "enter");
  useEffect(() => {
    if (!arriving) return;
    // Two frames, for the same reason `useDisclosure` needs them: the row has
    // to exist at zero height before the height it grows to is applied, or the
    // browser has no start value and the growth is a cut again.
    const grow = () =>
      setRendered((rows) =>
        rows.map((row) => (row.phase === "enter" ? { ...row, phase: "grow" } : row)),
      );
    let inner = 0;
    const frame = requestAnimationFrame(() => {
      inner = requestAnimationFrame(grow);
    });
    // And the same fallback, for the same tab: one that is not on screen gets
    // no frames at all, and a row waiting for the second of them would be stuck
    // at zero height — filtered in, but not there.
    const fallback = window.setTimeout(grow, 100);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(inner);
      window.clearTimeout(fallback);
    };
  }, [arriving]);

  /**
   * When this stage ends — and `enter` is not a stage.
   *
   * The two frames above are how an arrival is *started*, not how long it
   * lasts, so the signature this clock is keyed on counts an entering row as a
   * growing one. Keyed on the raw phases instead, a list holding one arriving
   * row restarted its timer two frames in and dragged every row leaving beside
   * it two frames late with it — visible as a stagger between Today's four
   * lists, one of which had an arrival in it and three of which did not. A row
   * that arrives now grows for two frames less than half the duration and lands
   * with everything else, which is the trade the house rule asks for: one
   * interaction, one start, one finish.
   */
  const clock = rendered.map((row) => (row.phase === "enter" ? "grow" : row.phase)).join("");
  useEffect(() => {
    if (rendered.every((row) => row.phase === "shown")) return;
    return advanceTogether(motionDuration(document.documentElement) / 2, () =>
      setRendered((rows) =>
        rows.flatMap((row) => {
          if (row.phase === "grow" || row.phase === "enter") {
            return [{ ...row, phase: "shown" as RowPhase }];
          }
          if (row.phase === "fade") return [{ ...row, phase: "shrink" as RowPhase }];
          if (row.phase === "shrink") return [];
          return [row];
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock]);

  return rendered;
}

/** Phases as heights, for a list whose rows are all `rowHeight` tall. */
export function useRowTransitions<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  rowHeight: number,
): readonly { key: string; item: T; motion: RowMotion }[] {
  const rendered = useRowPhases(items, keyOf);
  return useMemo(
    () => rendered.map(({ key, item, phase }) => ({ key, item, motion: motionOf(phase, rowHeight) })),
    [rendered, rowHeight],
  );
}


/* ─── Rows changing places ──────────────────────────────────────────────────
 *
 * Sorting a list is the third thing that can happen to a row, after arriving
 * and leaving, and it was the one that used to be a cut: every card was
 * somewhere else in the frame after the click, and nothing said which card had
 * gone where. A card that travels to its new place answers that by itself, and
 * it is the same answer the eye already gets from a row growing or fading.
 *
 * This is FLIP: read where everything is before the change, let React lay the
 * list out again, then put every element back where it started with a transform
 * and animate that transform away. Only the transform moves, so the reorder
 * costs no layout per frame, and the list is already in its final order for
 * anything that asks — clicks land on the card under the pointer even mid-
 * flight.
 * ────────────────────────────────────────────────────────────────────────── */

/** The travel in progress per element, so a second sort continues rather than fights it. */
const travelling = new WeakMap<Element, Animation>();

/**
 * Animate a list from the order it had to the order it has.
 *
 * `token` is whatever decides the order; the effect runs when it changes and
 * ignores every other reason the list re-rendered, so cards being folded,
 * filtered, or selected are left to the motion that owns them. `capture` has to
 * be called from the handler that changes `token`, before React re-renders:
 * that is the only moment the old positions still exist to be read.
 */
export function useReorderMotion(
  container: RefObject<HTMLElement | null>,
  token: string,
  /** Identifies a child across the reorder, e.g. `(box) => box.dataset.id`. */
  keyOf: (element: HTMLElement) => string | undefined,
): () => void {
  const positions = useRef(new Map<string, number>());
  const previousToken = useRef(token);

  const capture = () => {
    if (prefersReducedMotion()) return;
    const captured = new Map<string, number>();
    for (const box of boxesIn(container.current)) {
      const key = keyOf(box);
      // The rect of an element still travelling is where it *looks* to be,
      // which is where a second sort has to continue from.
      if (key !== undefined) captured.set(key, box.getBoundingClientRect().top);
    }
    positions.current = captured;
  };

  useLayoutEffect(() => {
    if (previousToken.current === token) return;
    previousToken.current = token;

    const before = positions.current;
    positions.current = new Map();
    if (before.size === 0 || prefersReducedMotion()) return;

    const duration = motionDuration(document.documentElement);
    const easing = motionCurveValue(document.documentElement);

    for (const box of boxesIn(container.current)) {
      const key = keyOf(box);
      const from = key === undefined ? undefined : before.get(key);
      if (from === undefined || typeof box.animate !== "function") continue;
      // Cancelled before measuring: a transform left over from the last sort
      // would otherwise be read as the position this one starts from.
      travelling.get(box)?.cancel();
      travelling.delete(box);

      const delta = from - box.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) continue;

      const animation = box.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }],
        { duration, easing },
      );
      travelling.set(box, animation);
      animation.finished
        .then(() => {
          if (travelling.get(box) === animation) travelling.delete(box);
        })
        .catch(() => {});
    }
  }, [container, keyOf, token]);

  return capture;
}

/** The list's own children, which are the boxes that move; their contents ride along. */
function boxesIn(root: HTMLElement | null): HTMLElement[] {
  return root ? Array.from(root.children).filter(isElement) : [];
}

function isElement(node: Element): node is HTMLElement {
  return node instanceof HTMLElement;
}
