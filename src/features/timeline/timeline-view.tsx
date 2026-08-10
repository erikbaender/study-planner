"use client";

/**
 * The timeline.
 *
 * A rebuild rather than a repair. The old Gantt drew unfocusable `div`s on a
 * canvas fifteen thousand pixels wide, had no today marker at all, and opened a
 * full-screen modal on every click — including the clicks that were meant to be
 * drags. What it got wrong is worth stating, because it is what this is built
 * around:
 *
 * - **A drag threshold.** A pointer that moves less than 4px was a click. Every
 *   attempt to nudge a bar used to open a modal instead.
 * - **Zoom.** Four scales, so a semester fits on a screen at Month and a week is
 *   legible at Day.
 * - **Bars are buttons.** Focusable, arrow-key movable, resizable with Shift,
 *   and named for a screen reader with their topic, dates and progress. The old
 *   ones could not be reached from a keyboard at all.
 * - **Progress inside the bar.** A half-done topic reads as half-full, so the
 *   chart answers "am I on top of this" and not only "when is it".
 * - **Popovers, not modals**, anchored to the bar you clicked.
 *
 * Course lanes are collapsible, with a roll-up bar when closed spanning the
 * course's scheduled work — the shape of a semester at a glance without ten
 * courses of forty topics unrolled underneath it.
 *
 * The canvas stays opaque: `backdrop-filter` on a surface scrolling hundreds of
 * bars costs more than the effect is worth (§7.1).
 */

import { clsx } from "clsx";
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Layers,
  Plus,
  Trash2,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import type { PlannerRepository } from "@/data/repository";
import {
  addDays,
  clampDate,
  compareDates,
  courseColorValue,
  differenceInDays,
  maxDate,
  minDate,
  topicProgress,
  UNIT_LABELS,
  weekdayOf,
  type Course,
  type CourseHealth,
  type IsoDate,
  type StudyBlock,
  type Topic,
} from "@/domain";
import {
  Badge,
  Button,
  ContextMenuAt,
  EmptyState,
  SegmentedControl,
  useKeyboardMode,
  type MenuItem,
} from "@/ui";
import {
  bandsFor,
  daysCss,
  daysMoved,
  dateAt,
  DAY_WIDTH_PROPERTY,
  PX_PER_DAY,
  shortDate,
  ticksFor,
  timelineRange,
  widthCss,
  widthOf,
  xCss,
  xOf,
  ZOOM_LABELS,
  ZOOMS,
  type Zoom,
} from "./geometry";
import { fillsByBlock, type Span } from "./blocks";
import {
  applyDelta,
  clampDelta,
  groupRange,
  type BarTarget,
  type DragMode,
} from "./selection";
import {
  animateScrollLeft,
  isScrollAnimating,
  motionCurveValue,
  motionDuration,
  prefersReducedMotion,
  stopScrollAnimation,
} from "./motion";
import {
  hintScope,
  hintExcludedScope,
  hintTarget,
  setInteractionHints,
  useViewHints,
  type InputHint,
} from "@/features/workspace/hints";
import { topicsForQuery } from "@/features/workspace/scope";
import { COURSE_FILTER_WILL_CHANGE } from "@/features/workspace/store";

const LANE_HEIGHT = 28;
const ROW_HEIGHT = 24;
/** The `pb-1` breathing room below an open group's last row, on the canvas side and in `GutterCard`. */
const GROUP_GAP = 4;
/** The two-tier header: a band of months or years over the ticks themselves. */
const BAND_HEIGHT = 18;
const TICK_HEIGHT = 18;
const RULER_HEIGHT = BAND_HEIGHT + TICK_HEIGHT;
/** Below this the pointer was steadying itself, not dragging. The old code had no threshold at all. */
const DRAG_THRESHOLD_PX = 4;
/** How close to an edge of the canvas triggers growing it further; see `contentRange`. */
const EXTEND_TRIGGER_PX = 1200;
/** How much canvas one extension adds, comfortably past `EXTEND_TRIGGER_PX` so it does not immediately re-trigger. */
const EXTEND_CHUNK_PX = 6000;
/** Breathing room left between a revealed bar and the edge it was hiding past. */
const REVEAL_PADDING_PX = 24;
/** The height the "no topics yet" line occupies while a course opens onto it. */
const EMPTY_COURSE_HEIGHT = 44;

/* ─── Label gutter ──────────────────────────────────────────────────────────
 *
 * One width for every label in the chart — course names, topic names, "All
 * topics" — instead of each row sizing to its own text. Independent widths
 * made the left edge of the canvas ragged and let a long name eat width no
 * neighbouring row needed; one shared column reads as a real gutter and costs
 * only as much space as the longest name actually on screen.
 * ────────────────────────────────────────────────────────────────────────── */

/** The row's own course colour, for the hover highlight both halves share. */
const ROW_TINT_PROPERTY = "--timeline-row-tint";

const GUTTER_MIN = 140;
const GUTTER_MAX = 320;

type LabelKind = "allTopics" | "course" | "topicWithDot" | "topicPlain";

/** Everything around the text — chevrons, dots, padding — that the column also has to fit. */
const LABEL_CHROME: Record<LabelKind, number> = {
  allTopics: 56, // chevron + layers icon + paddings
  course: 56, // chevron + colour dot + paddings
  topicWithDot: 30, // colour dot + paddings, no chevron
  topicPlain: 40, // the nested indent, no icon
};

const LABEL_WEIGHT: Record<LabelKind, number> = {
  allTopics: 600,
  course: 500,
  topicWithDot: 400,
  topicPlain: 400,
};

/**
 * Text width via canvas, not a DOM measurement.
 *
 * A DOM measurement would be exact, but costs a layout pass per label on
 * every render. `measureText` uses the same font metrics the browser lays the
 * text out with and is cheap enough to run for every visible row every time.
 */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, weight: number): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  // SSR, or a browser that refused a 2D context: a rough estimate beats a
  // 0-width flash on first paint.
  if (!measureCtx) return text.length * 7;
  measureCtx.font = `${weight} 12px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif`;
  return measureCtx.measureText(text).width;
}

/** The one width every label shares, sized to whichever visible name is longest. */
function gutterWidth(labels: readonly { text: string; kind: LabelKind }[]): number {
  const widest = labels.reduce(
    (max, { text, kind }) => Math.max(max, LABEL_CHROME[kind] + textWidth(text, LABEL_WEIGHT[kind])),
    0,
  );
  return Math.min(GUTTER_MAX, Math.max(GUTTER_MIN, Math.ceil(widest)));
}


/* ─── The three buttons ─────────────────────────────────────────────────────
 *
 * There is no mode any more. A View/Edit switch made the same press mean two
 * different things depending on a control at the other end of the toolbar, and
 * the workaround it needed — the right button as a held modifier — spent the one
 * button a chart like this owes to a context menu. Both are gone. Each button
 * does one thing, everywhere in the chart, always:
 *
 * - **Left** selects, and drags what is selected. On a bar: press and release
 *   without travelling and it is selected; travel and every selected bar moves
 *   with it, or resizes if the press landed on an edge. On empty canvas: a
 *   rectangle, which selects everything it touches, and a release that never
 *   travelled clears the selection.
 * - **Middle** moves the chart, from anywhere — a bar, the gutter, empty canvas.
 *   Panning is navigation, so it must never depend on finding somewhere safe to
 *   put the pointer down.
 * - **Right** opens the menu for whatever is under it: a bar offers to delete
 *   itself, empty lane offers a block on the day that was clicked.
 * ────────────────────────────────────────────────────────────────────────── */

const LEFT = 0;
const MIDDLE = 1;

/**
 * And the same thing said in the toolbar, always.
 *
 * The chart used to carry one line of prose describing the mode it was in. The
 * hint bar replaces it: what each button does, in the context the pointer is
 * actually in, in the one place in the app that answers that question. See
 * `workspace/hints.ts`.
 */
const CHART_HINTS: readonly InputHint[] = [
  { button: "left", label: "Box select", drag: true },
  { button: "middle", label: "Pan view", drag: true },
  { button: "right", label: "Actions" },
];

function chartSelectedHints(keyboardMode: "mac" | "windows"): readonly InputHint[] {
  return [
    CHART_HINTS[0],
    { button: "left", label: "Extend selection", modifier: "Shift", drag: true },
    {
      button: "left",
      label: "Subtract selection",
      modifier: keyboardMode === "mac" ? "⌘" : "Ctrl",
      drag: true,
    },
    CHART_HINTS[1],
    CHART_HINTS[2],
  ];
}

const BAR_HINTS: readonly InputHint[] = [
  { button: "left", label: "Select" },
  { button: "left", label: "Move", drag: true },
  { button: "right", label: "Actions" },
];

function barSelectedHints(keyboardMode: "mac" | "windows"): readonly InputHint[] {
  return [
    BAR_HINTS[0],
    BAR_HINTS[1],
    { button: "left", label: "Extend selection", modifier: "Shift" },
    {
      button: "left",
      label: "Subtract selection",
      modifier: keyboardMode === "mac" ? "⌘" : "Ctrl",
    },
    BAR_HINTS[2],
  ];
}

const RULER_HINTS: readonly InputHint[] = [
  { button: "left", label: "Pan view", drag: true },
];

const HANDLE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Resize", drag: true },
  { button: "middle", label: "Pan view", drag: true },
  { button: "right", label: "Actions" },
];

const MOVE_GESTURE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Move", drag: true },
];

const RESIZE_GESTURE_HINTS: readonly InputHint[] = [
  { button: "left", label: "Resize", drag: true },
];

const PAN_GESTURE_HINTS: readonly InputHint[] = [
  { button: "middle", label: "Pan view", drag: true },
];

/**
 * The selection, as Blender has it.
 *
 * Several bars can be selected; the inspector can describe one thing. So the
 * selection is ordered and the *last* thing added to it is primary — the one the
 * inspector follows, drawn with a full accent outline while the rest carry a
 * half-strength one. That is the same convention Blender's active-versus-selected
 * outline uses, and it answers the question a multi-selection otherwise leaves
 * open: which of these is the panel talking about?
 *
 * An external store rather than state on the chart: a selection change must
 * repaint the bars that changed and nothing else. Routed through React state it
 * would reconcile every lane in the plan on every click.
 */
export type BarSelection = "primary" | "secondary" | null;

type SelectionStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly string[];
  /** What this bar is, for the one bar asking. A primitive, so an unchanged bar never re-renders. */
  stateOf: (id: string) => BarSelection;
  set: (ids: readonly string[]) => void;
};

function createSelectionStore(): SelectionStore {
  let ids: readonly string[] = [];
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => ids,
    stateOf(id) {
      if (ids.length === 0) return null;
      if (ids[ids.length - 1] === id) return "primary";
      return ids.includes(id) ? "secondary" : null;
    },
    set(next) {
      if (next.length === ids.length && next.every((id, index) => id === ids[index])) return;
      ids = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Where the bars are *while* a drag is in flight.
 *
 * Each bar used to hold its own draft span in state, which is exactly right for
 * a gesture that moves one bar and useless for one that moves forty — and worse,
 * a block drawn in two lanes at once (its course's, and the combined lane) is two
 * components that would have to agree. One store keyed by block id, written each
 * frame, read by every bar that draws that block.
 */
type DraftStore = {
  subscribe: (listener: () => void) => () => void;
  spanOf: (id: string) => Span | null;
  set: (spans: ReadonlyMap<string, Span> | null) => void;
};

function createDraftStore(): DraftStore {
  let spans: ReadonlyMap<string, Span> | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // `null` for every bar not in the drag, on every frame of it: an unchanged
    // snapshot is what keeps `useSyncExternalStore` from re-rendering them.
    spanOf: (id) => spans?.get(id) ?? null,
    set(next) {
      spans = next;
      for (const listener of listeners) listener();
    },
  };
}

type Viewport = { from: IsoDate; to: IsoDate } | null;

/**
 * Scroll position is external to React's timeline tree.
 *
 * A top-level state update here used to reconcile the ruler, grid, 344 topic
 * lanes, and every bar whenever the viewport crossed a day. Marker consumers
 * subscribe directly instead, and their selector below keeps its snapshot
 * stable until one of that topic's blocks actually crosses an edge.
 */
type ViewportStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Viewport;
  setSnapshot: (next: Exclude<Viewport, null>) => void;
};

function createViewportStore(): ViewportStore {
  let snapshot: Viewport = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    setSnapshot(next) {
      if (snapshot?.from === next.from && snapshot.to === next.to) return;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

const EMPTY_VIEWPORT_STORE: ViewportStore = {
  subscribe: () => () => {},
  getSnapshot: () => null,
  setSnapshot: () => {},
};

const EMPTY_SELECTION_STORE: SelectionStore = {
  subscribe: () => () => {},
  getSnapshot: () => [],
  stateOf: () => null,
  set: () => {},
};

const EMPTY_DRAFT_STORE: DraftStore = {
  subscribe: () => () => {},
  spanOf: () => null,
  set: () => {},
};

type Chart = {
  scroller: React.RefObject<HTMLDivElement | null>;
  /** Shared mutation services, resolved once for the whole chart. */
  repository: PlannerRepository | null;
  run: (action: Promise<unknown>) => void;
  /** The committed scale for pointer hit-testing without a row render. */
  zoomRef: React.RefObject<Zoom>;
  viewport: ViewportStore;
  /** Bring a span just inside the given edge of the scrollport, animated. */
  reveal: (span: Span, side: "left" | "right") => void;
  selection: SelectionStore;
  drafts: DraftStore;
  /**
   * Every drawn block, by id. A gesture on one bar has to move all of them, and
   * a bar knows only its own topic — the registry is how the drag reaches the
   * others. A ref rather than a value so writing it does not invalidate the
   * context every lane consumes.
   */
  registry: React.RefObject<ReadonlyMap<string, BarTarget>>;
  /** Select these bars, last one primary, and point the inspector at it. */
  select: (ids: readonly string[]) => void;
  /** Nothing is selected now, and the inspector has nothing to describe. */
  clearSelection: () => void;
  /** The right-button menu, at the pointer, with the items the caller decided on. */
  openMenu: (at: { clientX: number; clientY: number }, items: readonly MenuItem[]) => void;
  /** The shared label-column width; see "Label gutter" above. */
  gutter: number;
};

const ChartContext = createContext<Chart>({
  scroller: { current: null },
  repository: null,
  run: () => {},
  zoomRef: { current: "week" },
  viewport: EMPTY_VIEWPORT_STORE,
  reveal: () => {},
  selection: EMPTY_SELECTION_STORE,
  drafts: EMPTY_DRAFT_STORE,
  registry: { current: new Map() },
  select: () => {},
  clearSelection: () => {},
  openMenu: () => {},
  gutter: GUTTER_MIN,
});

/**
 * A drag is not a click.
 *
 * The chart can be grabbed anywhere, including on top of real buttons — a
 * course header, an off-screen marker — and the browser still reports a click
 * on whatever the press started on once the hand comes up. Dragging the canvas
 * from a course name used to collapse the course, which reads as the chart
 * fighting the gesture. The one click a completed pan produces is eaten on the
 * capture phase, before the button under it hears about it; the timeout is for
 * the rare drag that ends where no click follows, so the guard never survives
 * into someone's next press.
 */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

/**
 * Grab-scrolling, on the middle button.
 *
 * The canvas moves under the pointer rather than the pointer picking anything
 * up, and the gesture is identical wherever it starts — on a bar, on a course
 * name, on empty canvas. That is the whole reason it is the middle button:
 * navigation that has to find somewhere safe to press is navigation you have to
 * think about.
 */
function startPan(event: React.PointerEvent, chart: Chart) {
  const element = chart.scroller.current;
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  setInteractionHints(PAN_GESTURE_HINTS);
  // Show the closed hand at press time, before the pointer has moved enough
  // to qualify as a drag.
  element.dataset.timelinePanning = "true";
  // A hand on the chart outranks anything it was doing by itself.
  stopScrollAnimation(element);

  const button = event.button;
  const originX = event.clientX;
  const originY = event.clientY;
  let lastX = event.clientX;
  let lastY = event.clientY;
  let panning = false;

  /**
   * Frame to frame, not press to now.
   *
   * The offset used to be recomputed from the position of the press — and the
   * chart moves the offset out from under a drag by itself: reaching the left
   * of the canvas grows it backward and shifts `scrollLeft` to hold the picture
   * still (see `pendingShiftRef`). Against an absolute origin the next move
   * undid that shift, which put the chart back where it had been, which
   * triggered the extension again. Dragging left simply stopped working, right
   * where the canvas has to grow. Applying each frame's delta instead means
   * anything else that legitimately moves the offset is left alone.
   */
  const move = (pointer: PointerEvent) => {
    if (
      !panning &&
      Math.abs(pointer.clientX - originX) < DRAG_THRESHOLD_PX &&
      Math.abs(pointer.clientY - originY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    panning = true;
    const deltaX = pointer.clientX - lastX;
    const deltaY = pointer.clientY - lastY;
    if (deltaX) element.scrollLeft -= deltaX;
    if (deltaY) element.scrollTop -= deltaY;
    lastX = pointer.clientX;
    lastY = pointer.clientY;
  };

  // Only the button that started this: a left press part-way through a pan is
  // not the end of it.
  const up = (pointer: PointerEvent) => {
    if (pointer.button !== button) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    delete element.dataset.timelinePanning;
    setInteractionHints(null);
    if (panning) swallowNextClick();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** The date ruler is its own horizontal drag affordance; it never pans vertically. */
function startRulerPan(event: React.PointerEvent, chart: Chart) {
  const element = chart.scroller.current;
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  setInteractionHints(RULER_HINTS);
  element.dataset.timelinePanning = "true";

  let lastX = event.clientX;
  const up = (pointer: PointerEvent) => {
    if (pointer.button !== event.button) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    delete element.dataset.timelinePanning;
    setInteractionHints(null);
  };
  const move = (pointer: PointerEvent) => {
    const deltaX = pointer.clientX - lastX;
    if (deltaX) element.scrollLeft -= deltaX;
    lastX = pointer.clientX;
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* ─── The left button ───────────────────────────────────────────────────── */

/**
 * A press on a bar.
 *
 * Blender's rule, because it is the one that never surprises: pressing an
 * unselected bar selects it, and only it, before anything moves — so a drag
 * always moves what you can see is selected. Pressing one that is already
 * selected leaves the selection alone, which is what makes dragging a group
 * possible at all. Shift defers to the release and toggles.
 *
 * Below the threshold nothing has moved, and the release is the selection.
 */
function startBarGesture(
  event: React.PointerEvent,
  chart: Chart,
  mode: DragMode,
  blockId: string,
) {
  event.stopPropagation();
  event.preventDefault();

  const scroller = chart.scroller.current;
  if (!scroller) return;
  if (mode === "start" || mode === "end") scroller.dataset.timelineResizing = "true";
  setInteractionHints(mode === "move" ? MOVE_GESTURE_HINTS : RESIZE_GESTURE_HINTS);

  const extend = event.shiftKey;
  const subtract = event.ctrlKey || event.metaKey;
  const selected = chart.selection.getSnapshot();
  if (!extend && !subtract && !selected.includes(blockId)) chart.select([blockId]);

  const ids = chart.selection.getSnapshot();
  const registry = chart.registry.current;
  // The bar under the hand always travels, even when the press is a
  // shift-extend that has not been applied yet.
  const targets: BarTarget[] = [];
  const seen = new Set<string>();
  for (const id of ids.includes(blockId) ? ids : [...ids, blockId]) {
    const target = registry.get(id);
    if (target && !seen.has(id)) {
      seen.add(id);
      targets.push(target);
    }
  }
  const limits = groupRange(mode, targets, seen);

  const originX = event.clientX;
  let dragging = false;
  let days = 0;

  const move = (pointer: PointerEvent) => {
    const deltaX = pointer.clientX - originX;
    if (!dragging && Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;
    dragging = true;
    scroller.dataset.timelineDragging = "true";
    days = clampDelta(limits, daysMoved(deltaX, chart.zoomRef.current));

    const spans = new Map<string, Span>();
    for (const { block } of targets) spans.set(block.id, applyDelta(mode, block, days));
    chart.drafts.set(spans);
    const grabbed = spans.get(blockId);
    if (grabbed) showReadout({ x: pointer.clientX, y: pointer.clientY, ...grabbed });
  };

  const up = (pointer: PointerEvent) => {
    if (pointer.button !== event.button) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    delete scroller.dataset.timelineDragging;
    delete scroller.dataset.timelineResizing;
    setInteractionHints(null);
    hideReadout();
    chart.drafts.set(null);

    if (!dragging) {
      // A tap. Shift toggles this bar in or out of the selection, while
      // Ctrl/⌘ removes it without disturbing the rest of the selection.
      if (subtract) {
        const current = chart.selection.getSnapshot();
        if (current.includes(blockId)) {
          chart.select(current.filter((id) => id !== blockId));
        }
      } else if (extend) {
        const current = chart.selection.getSnapshot();
        chart.select(
          current.includes(blockId)
            ? current.filter((id) => id !== blockId)
            : [...current, blockId],
        );
      } else {
        chart.select([blockId]);
      }
      return;
    }

    if (days === 0 || !chart.repository) return;
    const repository = chart.repository;
    chart.run(
      Promise.all(
        targets.map(({ block }) => {
          const next = applyDelta(mode, block, days);
          return repository.updateStudyBlock(block.id, {
            startDate: next.startDate,
            endDate: next.endDate,
            plannedUnits: block.plannedUnits,
          });
        }),
      ),
    );
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/**
 * A press on empty canvas: the rubber band.
 *
 * Empty canvas used to draw a new block, which meant the one gesture people try
 * first — sweeping across a chart to see what is in a fortnight — silently
 * created work. Creating is now a deliberate act on the right button, and the
 * sweep does what a sweep does everywhere else.
 *
 * Hit-testing is done against the DOM rather than against the plan: the band is
 * a rectangle on the screen, the bars are elements on the screen, and asking the
 * browser which of them overlap is both exact and free of the geometry the
 * scroll offset, the zoom and the gutter would otherwise have to be folded into.
 */
function startBoxSelect(event: React.PointerEvent, chart: Chart, band: HTMLElement | null) {
  const scroller = chart.scroller.current;
  if (!scroller) return;
  event.preventDefault();

  const originX = event.clientX;
  const originY = event.clientY;
  const extend = event.shiftKey;
  const subtract = event.ctrlKey || event.metaKey;
  let dragging = false;

  const move = (pointer: PointerEvent) => {
    if (
      !dragging &&
      Math.abs(pointer.clientX - originX) < DRAG_THRESHOLD_PX &&
      Math.abs(pointer.clientY - originY) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    dragging = true;
    if (!band) return;
    // Written straight to the element. The band moves with the pointer, and a
    // state update per frame would reconcile every lane in the plan.
    band.style.left = `${Math.min(originX, pointer.clientX)}px`;
    band.style.top = `${Math.min(originY, pointer.clientY)}px`;
    band.style.width = `${Math.abs(pointer.clientX - originX)}px`;
    band.style.height = `${Math.abs(pointer.clientY - originY)}px`;
    band.dataset.visible = "true";
  };

  const up = (pointer: PointerEvent) => {
    if (pointer.button !== event.button) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (band) band.dataset.visible = "false";

    if (!dragging) {
      if (!extend && !subtract) chart.clearSelection();
      return;
    }
    swallowNextClick();

    const left = Math.min(originX, pointer.clientX);
    const right = Math.max(originX, pointer.clientX);
    const top = Math.min(originY, pointer.clientY);
    const bottom = Math.max(originY, pointer.clientY);

    const hit: string[] = [];
    for (const element of scroller.querySelectorAll<HTMLElement>("[data-block-id]")) {
      const id = element.dataset.blockId;
      if (!id || hit.includes(id)) continue;
      const box = element.getBoundingClientRect();
      // Touching counts, as it does in Blender: a band drawn *over* a bar
      // without swallowing it whole has still pointed at it.
      if (box.right >= left && box.left <= right && box.bottom >= top && box.top <= bottom) {
        hit.push(id);
      }
    }

    if (subtract) {
      const current = chart.selection.getSnapshot();
      chart.select(current.filter((id) => !hit.includes(id)));
    } else if (extend) {
      const current = chart.selection.getSnapshot();
      chart.select([...current, ...hit.filter((id) => !current.includes(id))]);
    } else {
      chart.select(hit);
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

type TimelineProps = {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  today: IsoDate;
  query?: string;
  selectedId: string | null;
  onSelectTopic: (course: Course, topic: Topic) => void;
  /** Selection is a mode you can leave: see `selectTopic` below. */
  onClearSelection?: () => void;
  onGoToOutline: () => void;
};

/**
 * Keep an expensive chart alive while a focus filter is briefly empty.
 *
 * The sidebar's "hide every course" action is a visibility change, not a plan
 * deletion. Removing hundreds of rows in the same commit that shows the empty
 * state makes that harmless click compete with React's largest possible unmount.
 * Retaining the last non-empty chart, hidden and inert, makes the visible state
 * change a small overlay update; the chart is ready to reappear when courses
 * are shown again.
 */
export function TimelineView(props: TimelineProps) {
  const [retainedCourses, setRetainedCourses] = useState<readonly Course[]>(props.courses);
  // Capture the latest non-empty list before the commit that can make the
  // visible focus empty. This render-phase adjustment is bounded to actual
  // course-list changes; the chart uses `props.courses` directly for every
  // non-empty render, so it never shows stale data.
  if (props.courses.length > 0 && !sameCourseList(retainedCourses, props.courses)) {
    setRetainedCourses(props.courses);
  }

  const chartCourses = props.courses.length > 0 ? props.courses : retainedCourses;
  const chart = <MemoTimelineChart {...props} courses={chartCourses} />;
  const keepChart = props.courses.length === 0 && retainedCourses.length > 0;

  // The wrapper and chart stay at the same tree position in both states. A
  // changed parent shape would itself unmount the expensive child before the
  // memo comparator had a chance to protect it.
  return (
    <div className="relative h-full">
      <div
        className={keepChart ? "pointer-events-none invisible absolute inset-0" : "h-full"}
        aria-hidden={keepChart || undefined}
      >
        {chart}
      </div>
      {keepChart ? (
        <div className="relative flex h-full items-center justify-center">
          <NoTimelineCourses onGoToOutline={props.onGoToOutline} />
        </div>
      ) : null}
    </div>
  );
}

function TimelineChart({
  courses,
  health,
  today,
  query = "",
  selectedId,
  onSelectTopic,
  onClearSelection,
  onGoToOutline,
}: TimelineProps) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const zoomRef = useRef<Zoom>("week");
  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport] = useState(createViewportStore);
  const [selection] = useState(createSelectionStore);
  const keyboardMode = useKeyboardMode();
  const hasSelection = useSyncExternalStore(
    selection.subscribe,
    () => selection.getSnapshot().length > 0,
    () => false,
  );
  const selectedChartHints = useMemo(() => chartSelectedHints(keyboardMode), [keyboardMode]);
  useViewHints(hasSelection ? selectedChartHints : CHART_HINTS);
  const [drafts] = useState(createDraftStore);
  const bandRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: readonly MenuItem[] } | null>(null);
  const repository = useRepository();
  const run = usePlannerRun();
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Where today sat on screen when the zoom gesture began; see `changeZoom`. */
  const zoomFromRef = useRef<{ todayScreenX: number } | null>(null);
  /** The scale being animated *towards*, which `zoom` does not become until it lands. */
  const zoomTargetRef = useRef<Zoom | null>(null);
  const zoomTimerRef = useRef(0);

  // The canvas is a window onto an unbounded timeline, not a fixed span: a
  // plan has no "first" or "last" day, only days nothing happens to be
  // scheduled on yet. `contentRange` is just enough to fit what is actually
  // there; `extraBefore`/`extraAfter` are scroll-driven padding, grown by
  // `trackVisible` as the edges are approached so the scrollbar never becomes
  // a hard wall with real content — or the labels gutter sitting over it —
  // stuck just past it.
  const contentRange = useMemo(() => timelineRange(courses, today), [courses, today]);
  const courseKey = useMemo(() => courses.map((course) => course.id).join("\u0000"), [courses]);
  const [extraBefore, setExtraBefore] = useState(0);
  const [extraAfter, setExtraAfter] = useState(0);
  /** Days to add to `scrollLeft` once `extraBefore` takes effect, so growing the canvas backward does not visually shift it. */
  const pendingShiftRef = useRef(0);
  /** Prevent a burst of native scroll events from scheduling the same extension repeatedly. */
  const extendingBeforeRef = useRef(false);
  const extendingAfterRef = useRef(false);
  /** Once the user navigates, live plan updates must not reframe their view. */
  const userNavigatedRef = useRef(false);
  /** Keep the first layout correction invisible until its final position is ready. */
  const initializingRef = useRef(true);
  /** React may restore the declarative initial attribute on the next commit. */
  const clearInitialRevealRef = useRef(false);

  const revealInitialChart = useCallback(() => {
    if (!initializingRef.current) return;
    initializingRef.current = false;
    clearInitialRevealRef.current = true;
    // This is a visual settling flag, not application state. Removing it
    // directly avoids reconciling the entire timeline on the first pointer
    // press while the initial chart is fading in.
    canvasRef.current?.removeAttribute("data-timeline-zooming");
  }, []);

  // The canvas declares its initial hidden state so it is present on the first
  // paint. Once the imperative reveal has happened, remove that declaration
  // again after any commit that may have restored it. This is one layout effect
  // rather than state, so revealing a large chart does not reconcile every row.
  useLayoutEffect(() => {
    if (!clearInitialRevealRef.current) return;
    clearInitialRevealRef.current = false;
    canvasRef.current?.removeAttribute("data-timeline-zooming");
  });

  const range = useMemo(() => {
    const start = addDays(contentRange.start, -extraBefore);
    const end = addDays(contentRange.end, extraAfter);
    return { start, end, days: differenceInDays(start, end) + 1 };
  }, [contentRange.start, contentRange.end, extraBefore, extraAfter]);
  const rangeRef = useRef(range);
  /** A viewport anchor captured across a sidebar filter commit. */
  const filterAnchorRef = useRef<{ todayViewportX: number } | null>(null);
  const filterRestoreFrameRef = useRef<number | null>(null);
  const filterRestoreTimeoutRef = useRef<number | null>(null);
  const courseKeyRef = useRef(courseKey);

  // Sidebar filters announce before mutating workspace state. Capturing here
  // happens while the old canvas and scrollLeft are still intact; a layout
  // effect is already too late because the browser clamps scrollLeft as soon as
  // the shorter filtered canvas is committed.
  useEffect(() => {
    const capture = () => {
      const element = scrollRef.current;
      const marker = element?.querySelector<HTMLElement>(
        '[role="separator"][aria-label^="Today"]',
      );
      if (!marker) return;
      filterAnchorRef.current = { todayViewportX: marker.getBoundingClientRect().left };
      userNavigatedRef.current = true;
    };
    window.addEventListener(COURSE_FILTER_WILL_CHANGE, capture);
    return () => window.removeEventListener(COURSE_FILTER_WILL_CHANGE, capture);
  }, []);
  /**
   * Filtering changes the range's left edge when the hidden course contained
   * the earliest block. The pre-change listener above owns capture; this effect
   * only records which filtered course set has committed.
   */
  useLayoutEffect(() => {
    if (courseKeyRef.current !== courseKey) {
      courseKeyRef.current = courseKey;
    } else {
      // A search can change without changing which course ids are present. No
      // range restoration is needed, and the pre-change anchor must not leak
      // into a later unrelated update.
      filterAnchorRef.current = null;
    }
  }, [courseKey, query]);
  useLayoutEffect(() => {
    rangeRef.current = range;
  }, [range]);

  // Independent of `everyTopic` below on purpose: that array is sorted for
  // display, this only needs to know which names are on screen.
  const visibleCourseTopics = useMemo(
    () => courses.map((course) => ({ course, topics: topicsForQuery(query, course) })),
    [courses, query],
  );

  const gutter = useMemo(() => {
    const labels: { text: string; kind: LabelKind }[] = [];
    if (visibleCourseTopics.some(({ topics }) => topics.length > 0)) {
      labels.push({ text: "All courses", kind: "allTopics" });
    }
    for (const { course, topics } of visibleCourseTopics) {
      labels.push({ text: course.name, kind: "course" });
      // The gutter width is structural, so it must not change as a disclosure
      // opens. Accounting for both label variants once keeps opening a course a
      // local update and avoids moving every sticky card in the chart.
      for (const topic of topics) {
        labels.push({ text: topic.name, kind: "topicWithDot" });
        labels.push({ text: topic.name, kind: "topicPlain" });
      }
    }
    return gutterWidth(labels);
  }, [visibleCourseTopics]);
  const gutterRef = useRef(gutter);

  const width = useMemo(() => range.days * PX_PER_DAY[zoom], [range.days, zoom]);
  const widthRef = useRef(width);
  useLayoutEffect(() => {
    gutterRef.current = gutter;
    widthRef.current = width;
  }, [gutter, width]);
  const ticks = useMemo(() => ticksFor(range.start, range.end, zoom), [range.start, range.end, zoom]);
  const bands = useMemo(() => bandsFor(range.start, range.end, zoom), [range.start, range.end, zoom]);

  // Today just clear of the label gutter, not a third of the way in: what is
  // coming is what the chart is for, so the whole width goes to it.
  const todayOffset = useCallback(
    () => xOf(today, range.start, zoom) - gutter - REVEAL_PADDING_PX,
    [gutter, range.start, today, zoom],
  );

  const trackVisible = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    // Nothing while an animation owns the offset. Recomputing every lane's
    // off-screen markers on each frame of a zoom is most of what made one
    // expensive, and the answer is stale for 240ms rather than wrong: the
    // animation runs this once more when it lands.
    if (isScrollAnimating(element)) return;
    const from = dateAt(element.scrollLeft, range.start, zoom);
    const to = dateAt(element.scrollLeft + element.clientWidth, range.start, zoom);
    viewport.setSnapshot({ from, to });

    // Grown well before the edge is reached, and by enough that a moment's
    // more scrolling cannot outrun it: `EXTEND_CHUNK_PX` clears the trigger by
    // a wide margin, so one extension is enough until the next.
    //
    // Guarded on a *laid-out* canvas rather than an already-scrollable one. The
    // old test was `scrollWidth > clientWidth`, which is the one case that most
    // needs extending: a plan whose whole span fits on screen has no scroll to
    // give, so it could never fire the scroll event that was the only thing
    // asking it to grow. It stayed exactly as wide as its content, which is
    // what "the chart abruptly ends" is — an unscrollable canvas with a hard
    // edge a fortnight either side of the work. An element that has not been
    // laid out yet reports zero for both, which reads as "at both edges at
    // once"; a canvas with any width at all rules that out, and a real one
    // always has width — it is days times the width of a day.
    if (element.scrollWidth > 0) {
      const chunkDays = Math.ceil(EXTEND_CHUNK_PX / PX_PER_DAY[zoom]);
      if (element.scrollLeft < EXTEND_TRIGGER_PX && !extendingBeforeRef.current) {
        extendingBeforeRef.current = true;
        pendingShiftRef.current += chunkDays * PX_PER_DAY[zoom];
        setExtraBefore((days) => days + chunkDays);
      }
      if (
        element.scrollWidth - (element.scrollLeft + element.clientWidth) < EXTEND_TRIGGER_PX &&
        !extendingAfterRef.current
      ) {
        extendingAfterRef.current = true;
        setExtraAfter((days) => days + chunkDays);
      }
    }
  }, [range.start, viewport, zoom]);

  /**
   * The one definition of where Today belongs. Initial positioning uses the
   * instant form; the toolbar uses the animated form, but both always target
   * this same current range and gutter.
   */
  const scrollToToday = useCallback(
    (animated: boolean) => {
      const element = scrollRef.current;
      if (!element) return;
      if (animated) {
        filterAnchorRef.current = null;
        if (filterRestoreFrameRef.current !== null) {
          cancelAnimationFrame(filterRestoreFrameRef.current);
          filterRestoreFrameRef.current = null;
        }
        if (filterRestoreTimeoutRef.current !== null) {
          window.clearTimeout(filterRestoreTimeoutRef.current);
          filterRestoreTimeoutRef.current = null;
        }
        userNavigatedRef.current = true;
        revealInitialChart();
      }
      const target = todayOffset();
      if (animated) {
        animateScrollLeft(element, target, () => {
          trackVisible();
        });
      } else {
        stopScrollAnimation(element);
        element.scrollLeft = target;
        trackVisible();
      }
    },
    [revealInitialChart, todayOffset, trackVisible],
  );

  // Extending the canvas backward moves every date to a larger x (the same
  // date is now further from the new, earlier `start`). Left uncorrected,
  // that reads as the chart lurching forward the instant it grows; shifting
  // `scrollLeft` by the same amount before the browser paints holds the
  // visible content still.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element && pendingShiftRef.current) {
      element.scrollLeft += pendingShiftRef.current;
      pendingShiftRef.current = 0;
    }
    extendingBeforeRef.current = false;
    extendingAfterRef.current = false;
  }, [extraBefore, extraAfter]);

  /**
   * Opening on today — once the plan is there to open onto.
   *
   * Opening on the far left of the canvas — weeks of finished work — made
   * "press Today" the first action of every visit, so this does it for them,
   * without the animation, so the first paint is already in the right place.
   *
   * It cannot be a mount-only effect, because the timeline mounts before the
   * repository has answered. With no courses, `timelineRange` is a fortnight
   * around today: a canvas narrower than the scrollport, already showing
   * everything it has. Priming *that* and never again left the chart on a
   * range it had outgrown — and the canvas only extends from `trackVisible`,
   * which nothing calls again once the scrolling is over, so the chart stayed
   * short, unscrollable, and abrupt at both ends for the rest of the visit.
   * The tell was that selecting a topic fixed it: the inspector opening
   * resizes the scrollport, and the resize observer below runs `trackVisible`.
   *
   * So it waits for a plan and then runs exactly once. Re-running after that
   * would yank the canvas back to today while someone is reading elsewhere.
   */
  const primedRef = useRef(false);
  /** The range used for the last initial-prime check, before live data settles. */
  const primedContentRangeRef = useRef<{ start: IsoDate; end: IsoDate } | null>(null);
  /** The rendered range for which the initial scroll target was calculated. */
  const primedRenderedRangeRef = useRef<IsoDate | null>(null);
  /**
   * Also: not until the chart is actually on screen.
   *
   * Switching to the timeline from another view can mount it — or reveal it —
   * with a scrollport or canvas that has no width yet, and an offset written to
   * it is discarded. That is why arriving from Today or
   * Outline used to land the chart nowhere in particular while a reload landed
   * it on today. `clientWidth` is the test for "displayed", and the resize
   * observer below calls this again the moment that becomes true.
   */
  const primeToday = useCallback(() => {
    const element = scrollRef.current;
    if (!element || primedRef.current) return;
    if (courses.length === 0 || element.clientWidth === 0) return;
    // A visible scrollport can briefly exist before its canvas has laid out.
    // Do not consume the one-time prime in that frame: a write would clamp to
    // zero and the later layout would otherwise leave the chart there.
    if (element.scrollWidth === 0) return;
    primedRef.current = true;
    primedRenderedRangeRef.current = range.start;
    scrollToToday(false);
  }, [courses.length, range.start, scrollToToday]);

  // Run before the first visible paint when the timeline is already laid out;
  // the ResizeObserver below covers the case where the view is revealed later.
  useLayoutEffect(primeToday, [primeToday]);

  // Repository-backed plans can arrive in more than one commit. If the first
  // commit primed against a short/old range, the canvas moves its historical
  // left edge when the complete range arrives. Re-prime that initial view so
  // it lands at Today; after any user navigation, preserve their position.
  useLayoutEffect(() => {
    const previous = primedContentRangeRef.current;
    primedContentRangeRef.current = { start: contentRange.start, end: contentRange.end };
    if (
      previous &&
      (previous.start !== contentRange.start || previous.end !== contentRange.end) &&
      !userNavigatedRef.current
    ) {
      primedRef.current = false;
      primeToday();
    }
  }, [contentRange.start, contentRange.end, primeToday]);

  // A left-edge extension changes the x-coordinate of Today. The pending
  // scroll correction above preserves the old picture, which is right during
  // normal scrolling but can follow the initial prime and leave it historical.
  // Recalculate once for the new range while initialization still owns the
  // position.
  useLayoutEffect(() => {
    if (
      userNavigatedRef.current ||
      !primedRef.current ||
      primedRenderedRangeRef.current === null ||
      primedRenderedRangeRef.current === range.start
    ) {
      return;
    }
    pendingShiftRef.current = 0;
    primedRef.current = false;
    primeToday();
  }, [range.start, primeToday]);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    // A browser-restored scroll can arrive after the canvas has already
    // painted. Until the user touches the chart, that event is not intent and
    // must not replace the initial Today position.
    if (!userNavigatedRef.current && !isScrollAnimating(element)) {
      primedRef.current = false;
      scrollToToday(false);
      return;
    }
    trackVisible();
  }, [scrollToToday, trackVisible]);

  // Edge and Chromium-based browsers can restore a previous horizontal
  // scrollLeft after the first layout pass. Give that restoration two frames
  // to finish, then make the initial Today position authoritative. Leave a few
  // more frames for a range extension and its layout correction to commit
  // before fading in; a fixed timeout can reveal the chart in between those two
  // writes and make it jump immediately after the fade. This pass is
  // intentionally skipped after the user has touched the chart.
  useEffect(() => {
    if (courses.length === 0) return;
    let secondFrame = 0;
    let revealFrame = 0;
    // Background/collaborative tabs can throttle animation frames. Keep a
    // guarded fallback so the chart cannot remain hidden forever there; in a
    // visible tab the settled frame sequence below reveals it first.
    const revealTimeout = window.setTimeout(revealInitialChart, 700);
    if (typeof requestAnimationFrame === "undefined") {
      return () => window.clearTimeout(revealTimeout);
    }
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (userNavigatedRef.current) return;
        primedRef.current = false;
        primeToday();
        // `primeToday` can grow the range. Wait a few frames so that the
        // resulting layout and scroll correction are committed before fading
        // the chart into view.
        let remaining = 4;
        const waitForSettling = () => {
          if (!initializingRef.current || userNavigatedRef.current) return;
          if (remaining-- === 0) {
            revealInitialChart();
            return;
          }
          revealFrame = requestAnimationFrame(waitForSettling);
        };
        revealFrame = requestAnimationFrame(waitForSettling);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      cancelAnimationFrame(revealFrame);
      window.clearTimeout(revealTimeout);
    };
    // This is the mount/data-load settling pass; zoom and range changes have
    // their own positioning paths and must not reframe an active chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.length]);

  // And the canvas keeps growing without being scrolled. Extension used to be
  // driven only by `onScroll`, which cannot start: a canvas that is not yet
  // wider than its scrollport has no scroll to fire the event that would widen
  // it. Re-checking whenever the range or the scale changes breaks that
  // circle, and settles — each extension clears `EXTEND_TRIGGER_PX` by a wide
  // margin, so the next pass has nothing left to do.
  useEffect(() => {
    trackVisible();
  }, [trackVisible]);

  // Zooming used to be a teleport twice over: the scroll offset was kept in
  // pixels while the pixels changed meaning, so leaving Week for Day landed you
  // months from where you were looking — and it arrived in one frame, with no
  // way to see that the scale rather than the plan had changed.
  //
  /**
   * The zoom, as a fade.
   *
   * Every position in the chart is a `calc()` off one custom property, so
   * animating the *geometry* re-lays-out several thousand absolutely positioned
   * elements per frame — two earlier attempts did that and stuttered. A third
   * stood a `scaleX` in for the scale change, which the compositor runs for
   * free but which is a lie about what happened: the bars stretch, the labels
   * squash, and Week to Quarter reads as the chart being pulled rather than
   * redrawn.
   *
   * So nothing pretends to be the intermediate scale, because there isn't one.
   * The chart layers fade out to the surface behind them, the new scale is
   * committed while there is nothing on screen to see it land, and they fade
   * back. Two short halves of the shared duration on the shared curve, and the
   * only property animating is opacity. The course/topic gutter stays visible
   * throughout because it is a separate overlay layer.
   *
   * `scrollLeft` is set here, in the dark, so the today marker keeps the screen
   * position it had when the gesture started — the one thing that must not move
   * while the scale changes is the thing you navigate by.
   */
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const canvas = canvasRef.current;
    const zoomed = zoomFromRef.current;
    zoomFromRef.current = null;
    zoomTargetRef.current = null;
    if (!element || !canvas || !zoomed) return;

    element.scrollLeft = xOf(today, range.start, zoom) - zoomed.todayScreenX;
    trackVisible();
    // The geometry has landed while the chart was hidden. Releasing this
    // attribute starts the same chart-only fade-in for every zoom level; the
    // gutter is not a descendant of any faded layer.
    canvas.dataset.timelineZooming = "false";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // A course filter can move the range's origin, but it must not move the
  // user's viewport. Restore from the rendered marker rather than from the
  // React range arithmetic: filtering can settle through several commits while
  // the canvas padding is extended, and the DOM is the source of truth for the
  // position the user actually sees.
  useLayoutEffect(() => {
    const anchor = filterAnchorRef.current;
    const element = scrollRef.current;
    if (!anchor || !element) return;
    if (filterRestoreFrameRef.current !== null) {
      cancelAnimationFrame(filterRestoreFrameRef.current);
    }
    if (filterRestoreTimeoutRef.current !== null) {
      window.clearTimeout(filterRestoreTimeoutRef.current);
      filterRestoreTimeoutRef.current = null;
    }
    let stableFrames = 0;
    let lastWidth = -1;
    let frames = 0;
    const settle = () => {
      if (filterAnchorRef.current !== anchor || !scrollRef.current) return;
      const current = scrollRef.current;
      const marker = current.querySelector<HTMLElement>('[role="separator"][aria-label^="Today"]');
      if (!marker) return;
      const target = anchor.todayViewportX;
      const actual = marker.getBoundingClientRect().left;
      const delta = actual - target;
      if (Math.abs(delta) > 0.5) {
        current.scrollLeft += delta;
        stableFrames = 0;
      } else if (current.scrollWidth === lastWidth) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }
      lastWidth = current.scrollWidth;
      frames += 1;
      if (stableFrames >= 3 || frames >= 30) {
        filterAnchorRef.current = null;
        filterRestoreFrameRef.current = null;
        if (filterRestoreTimeoutRef.current !== null) {
          window.clearTimeout(filterRestoreTimeoutRef.current);
          filterRestoreTimeoutRef.current = null;
        }
        trackVisible();
        return;
      }
      filterRestoreFrameRef.current = requestAnimationFrame(settle);
    };
    // Correct once in the layout effect as well as in the frame loop. A hidden
    // background tab may throttle animation frames, but its first committed
    // layout still needs the viewport anchor immediately.
    settle();
    const retryAfterLayout = () => {
      if (filterAnchorRef.current !== anchor) return;
      settle();
      if (filterAnchorRef.current === anchor) {
        filterRestoreTimeoutRef.current = window.setTimeout(retryAfterLayout, 50);
      }
    };
    filterRestoreTimeoutRef.current = window.setTimeout(retryAfterLayout, 50);
  }, [courseKey, trackVisible]);

  useEffect(
    () => () => {
      window.clearTimeout(zoomTimerRef.current);
      if (filterRestoreFrameRef.current !== null) {
        cancelAnimationFrame(filterRestoreFrameRef.current);
      }
      if (filterRestoreTimeoutRef.current !== null) {
        window.clearTimeout(filterRestoreTimeoutRef.current);
      }
      canvasRef.current?.removeAttribute("data-timeline-zooming");
    },
    [],
  );

  // A sidebar or inspector resize changes the right edge without a scroll.
  // Keep markers correct without making viewport dimensions React state.
  useEffect(() => {
    const element = scrollRef.current;
    const canvas = canvasRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      primeToday();
      trackVisible();
    });
    observer.observe(element);
    // The scrollport can have a size before the timeline canvas does. That
    // ordering is common when switching views, and observing only the former
    // leaves a skipped initial prime stranded at scrollLeft 0.
    if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  }, [primeToday, trackVisible]);

  /**
   * The zoom, started on the click.
   *
   * Everything here reads geometry that is already on screen — today's x at the
   * *committed* scale — so it costs nothing and runs in the click's own frame.
   * The fade is the only thing that moves; `zoom` follows it, `duration` later,
   * in the effect above.
   *
   * Zooming again mid-flight retargets rather than restarting: `zoom` has not
   * changed, so the origin and the geometry under it have not either, and
   * leaving the fade in place lets the same transition carry on from wherever
   * it had got to. That is also why the screen position is always measured from
   * the committed zoom rather than from the one being left.
   */
  const changeZoom = (next: Zoom) => {
    const element = scrollRef.current;
    const canvas = canvasRef.current;
    if (next === (zoomTargetRef.current ?? zoom)) return;

    if (!element || !canvas || prefersReducedMotion()) {
      zoomFromRef.current = element
        ? { todayScreenX: xOf(today, range.start, zoom) - element.scrollLeft }
        : { todayScreenX: 0 };
      setZoom(next);
      revealInitialChart();
      clearInitialRevealRef.current = false;
      return;
    }

    window.clearTimeout(zoomTimerRef.current);
    userNavigatedRef.current = true;
    revealInitialChart();
    // The next fade belongs to zoom, not the initial reveal; do not let the
    // initial-attribute cleanup remove that zoom veil on its commit.
    clearInitialRevealRef.current = false;
    // Captured once per gesture: zooming again mid-fade is still aiming at the
    // place the first click started from, and `zoom` has not moved yet either.
    zoomFromRef.current ??= {
      todayScreenX: xOf(today, range.start, zoom) - element.scrollLeft,
    };
    zoomTargetRef.current = next;

    const half = motionDuration(element) / 2;
    // If the chart is already fading out it stays hidden. If a click arrives
    // during the fade-in, the same transition reverses from its current
    // opacity. Replacing the timer below means only the latest target lands.
    canvas.dataset.timelineZooming = "true";
    zoomTimerRef.current = window.setTimeout(() => setZoom(next), half);
  };

  /**
   * Bring a span just inside an edge, rather than centring it.
   *
   * Centring re-framed the whole chart to show one bar: everything you had been
   * reading left the screen so that the thing you were curious about could sit
   * in the middle. Scrolling exactly far enough keeps the context you already
   * had and adds the bar to it — clear of the label gutter on the left, and of
   * the scrollport's own edge on the right, with room to read either way.
   */
  const trackVisibleRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    trackVisibleRef.current = trackVisible;
  }, [trackVisible]);
  const reveal = useCallback((span: Span, side: "left" | "right") => {
    const element = scrollRef.current;
    if (!element) return;
    const currentRange = rangeRef.current;
    const currentZoom = zoomRef.current;
    const from = xOf(span.startDate, currentRange.start, currentZoom);
    const to = from + widthOf(span.startDate, span.endDate, currentZoom);
    const target =
      side === "left"
        ? from - gutterRef.current - REVEAL_PADDING_PX
        : to + REVEAL_PADDING_PX - element.clientWidth;
    // `trackVisible` on arrival, not on the way: the marker you just used is
    // only stale until the scroll lands, and it used to stay on screen until
    // the chart was dragged by hand because nothing recomputed it.
    animateScrollLeft(
      element,
      Math.min(target, Math.max(0, widthRef.current - element.clientWidth)),
      () => trackVisibleRef.current(),
    );
  }, []);

  // The shell recreates its tiny action closures when sidebar state changes.
  // Keep the latest one available without making the chart context — and every
  // row consuming it — change for an unrelated shell render.
  const onClearSelectionRef = useRef(onClearSelection);
  const onSelectTopicRef = useRef(onSelectTopic);
  useLayoutEffect(() => {
    onClearSelectionRef.current = onClearSelection;
    onSelectTopicRef.current = onSelectTopic;
  }, [onClearSelection, onSelectTopic]);

  /**
   * Every block on the chart, by id.
   *
   * A drag begun on one bar has to move every selected bar, which may belong to
   * any topic in the plan — and a bar knows only its own. Rebuilt whenever the
   * visible topics change and read through a ref, so a gesture always sees the
   * current plan without the registry becoming a reason to re-render.
   */
  const registry = useMemo(() => {
    const entries = new Map<string, BarTarget>();
    for (const { topics } of visibleCourseTopics) {
      for (const topic of topics) {
        for (const block of topic.blocks) entries.set(block.id, { block, topic });
      }
    }
    return entries;
  }, [visibleCourseTopics]);
  const registryRef = useRef<ReadonlyMap<string, BarTarget>>(registry);
  useLayoutEffect(() => {
    registryRef.current = registry;
  }, [registry]);

  /**
   * Selecting bars, and the one the inspector follows.
   *
   * The inspector describes a topic, and a selection of bars can span several —
   * so it follows the *primary* bar, the one added last. Clearing the selection
   * clears the inspector with it, because an empty chart selection describing a
   * topic is the panel talking about something nothing on screen points at.
   */
  const clearSelection = useCallback(() => {
    selection.set([]);
    onClearSelectionRef.current?.();
  }, [selection]);

  const select = useCallback(
    (ids: readonly string[]) => {
      selection.set(ids);
      const primary = ids.length > 0 ? registryRef.current.get(ids[ids.length - 1]) : undefined;
      if (!primary) {
        onClearSelectionRef.current?.();
        return;
      }
      const course = courses.find((candidate) =>
        candidate.topics.some((topic) => topic.id === primary.topic.id),
      );
      if (course) onSelectTopicRef.current(course, primary.topic);
    },
    [courses, selection],
  );

  const openMenu = useCallback(
    (at: { clientX: number; clientY: number }, items: readonly MenuItem[]) => {
      if (items.length === 0) return;
      setMenu({ x: at.clientX, y: at.clientY, items });
    },
    [],
  );

  const chart = useMemo<Chart>(
    () => ({
      scroller: scrollRef,
      repository,
      run,
      zoomRef,
      viewport,
      reveal,
      selection,
      drafts,
      registry: registryRef,
      select,
      clearSelection,
      openMenu,
      gutter,
    }),
    [clearSelection, drafts, gutter, openMenu, repository, reveal, run, select, selection, viewport],
  );

  /** A label in the gutter selects its topic; that is a selection of rows, not of bars. */
  const selectTopic = useCallback(
    (course: Course, topic: Topic) => {
      selection.set([]);
      if (topic.id === selectedId) onClearSelectionRef.current?.();
      else onSelectTopicRef.current(course, topic);
    },
    [selectedId, selection],
  );

  // Chronological, not grouped: the combined lane exists to show the plan as a
  // sequence, and a topic's place in that sequence is where its work *starts* —
  // its earliest block, whatever else it has scheduled later. Topics with
  // nothing scheduled have no place in the order, so they go to the end, where
  // they read as a backlog waiting to be placed. Keep this derived list stable
  // while a local disclosure is animating; rebuilding it used to make every
  // course toggle pay for a full sort of the plan.
  const everyTopic = useMemo(
    () =>
      visibleCourseTopics
        .flatMap(({ course, topics }) => topics.map((topic) => ({ course, topic })))
        .map((entry) => ({ ...entry, from: firstBlockStart(entry.topic) }))
        .sort((left, right) => {
          if (left.from === right.from) return left.topic.name.localeCompare(right.topic.name);
          if (!left.from) return 1;
          if (!right.from) return -1;
          return compareDates(left.from, right.from);
        }),
    [visibleCourseTopics],
  );

  if (courses.length === 0) {
    return <NoTimelineCourses onGoToOutline={onGoToOutline} />;
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-separator px-4 py-2">
        {/* First, and the one filled control on the bar: "where am I now" is the
            question this chart is asked most, and the answer should not have to
            be found among the settings for how it is drawn. */}
        <Button
          size="sm"
          variant="accent"
          leadingIcon={<CalendarDays />}
          onClick={() => scrollToToday(true)}
        >
          Today
        </Button>
        <ZoomControl zoom={zoom} onChange={changeZoom} />
        <Legend />
      </div>

      <ChartContext.Provider value={chart}>
      <div
        ref={scrollRef}
        // The chart has its own menu on this button, and the browser's would
        // only ever cover it. Every menu the chart *does* open is opened from
        // the handlers on the bar or lane the press landed on.
        onContextMenu={(event) => event.preventDefault()}
        onScroll={handleScroll}
        // Captured rather than bubbled: the middle button is navigation and
        // outranks whatever it happens to be pressed on top of, so it is taken
        // before the bar or lane under it hears about the press at all.
        onPointerDownCapture={(event) => {
          userNavigatedRef.current = true;
          revealInitialChart();
          if (event.button === MIDDLE) {
            if (
              event.target instanceof Element &&
              event.target.closest(".timeline-course-panel, .timeline-ruler")
            ) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            event.stopPropagation();
            startPan(event, chart);
          }
        }}
        // Anything the press was not claimed by is empty canvas, and a press on
        // empty canvas is a rubber band. Chrome — the gutter, the off-screen
        // markers — is excluded: those are controls sitting over the chart.
        onPointerDown={(event) => {
          if (event.button !== LEFT) return;
          if (event.target instanceof Element && event.target.closest(".timeline-chrome")) return;
          startBoxSelect(event, chart, bandRef.current);
        }}
        // The browser's middle-click autoscroll would otherwise start on top of
        // the pan, with a scroll anchor of its own.
        onAuxClick={(event) => event.preventDefault()}
        onWheel={() => {
          userNavigatedRef.current = true;
          revealInitialChart();
        }}
        className="timeline-scrollport min-h-0 flex-1 overflow-auto bg-content"
      >
        <div
          ref={canvasRef}
          {...hintScope}
          // Every position below is a `calc()` off this one length, so the
          // transition on `.timeline-canvas` is the whole zoom animation.
          style={
            { width: daysCss(range.days), [DAY_WIDTH_PROPERTY]: `${PX_PER_DAY[zoom]}px` } as React.CSSProperties
          }
          className="timeline-canvas relative"
          data-timeline-zooming="true"
        >
          <Ruler ticks={ticks} bands={bands} range={range} today={today} zoom={zoom} />

          {/* Drawn once behind every lane rather than per lane, so the rules are
              continuous down the whole chart instead of restarting at each. */}
          <Weekends range={range} zoom={zoom} />
          <Rules ticks={ticks} range={range} zoom={zoom} />
          <ExamMarkers courses={courses} range={range} />
          <TodayLine today={today} range={range} />

          <div className="relative">
            <MemoAllTopicsLane
              entries={everyTopic}
              range={range}
              today={today}
              selectedId={selectedId}
              onSelectTopic={selectTopic}
            />
            {courses.map((course) => (
              <MemoCourseLane
                key={course.id}
                course={course}
                health={health.get(course.id)}
                topics={visibleCourseTopics.find((entry) => entry.course === course)?.topics ?? []}
                range={range}
                today={today}
                selectedId={selectedId}
                onSelectTopic={(topic) => selectTopic(course, topic)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Both of these are written to directly by the gestures above rather than
          rendered from state: a rubber band and a date readout follow the
          pointer, and a React update per frame would reconcile every lane in
          the plan to move a rectangle four pixels. */}
      <div ref={bandRef} data-visible="false" aria-hidden="true" className="timeline-band" />
      <DragReadout />

      <ContextMenuAt
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) setMenu(null);
        }}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menu?.items ?? []}
      />
      </ChartContext.Provider>
    </div>
  );
}

function NoTimelineCourses({ onGoToOutline }: { onGoToOutline: () => void }) {
  return (
    <EmptyState
      icon={<CalendarRange />}
      title="Nothing to show"
      description="No course matches the current focus. Widen it in the sidebar, or add material in the outline."
      action={
        <Button variant="accent" onClick={onGoToOutline}>
          Open the outline
        </Button>
      }
    />
  );
}

/* ─── Chrome ────────────────────────────────────────────────────────────── */

/**
 * The zoom control, with its own idea of the value.
 *
 * `zoom` does not change until the transform that stands in for it has finished
 * travelling (see `changeZoom`), and a control that waited that long for its
 * thumb to move would be the very lag the animation was reordered to remove.
 * Holding the pressed value locally keeps the thumb on the click *and* keeps
 * the chart out of the re-render it would otherwise cost — a state update in
 * `TimelineView` reconciles every lane in the plan; one in here reconciles four
 * buttons.
 */
function ZoomControl({ zoom, onChange }: { zoom: Zoom; onChange: (next: Zoom) => void }) {
  const [shown, setShown] = useState(zoom);
  const [committed, setCommitted] = useState(zoom);
  // Whatever else moved it — a scale landing, a zoom refused — the control says
  // what the chart is actually drawn at. Adjusted during render rather than in
  // an effect, so the thumb never spends a frame on the wrong segment.
  if (committed !== zoom) {
    setCommitted(zoom);
    setShown(zoom);
  }

  return (
    <SegmentedControl<Zoom>
      size="sm"
      label="Zoom"
      className="timeline-segments"
      value={shown}
      onValueChange={(next) => {
        setShown(next);
        onChange(next);
      }}
      segments={ZOOMS.map((candidate) => ({ value: candidate, label: ZOOM_LABELS[candidate] }))}
    />
  );
}

type Range = { start: IsoDate; end: IsoDate; days: number };

/**
 * The ruler, in two tiers.
 *
 * The lower tier is the old one: days, weeks or months. The upper is the
 * context it never carried — the month a "12" belongs to, the year a "Feb"
 * belongs to. Each band's label is sticky *within its own band*, so scrolling
 * halfway through March still says March instead of leaving the label off the
 * left edge with nothing to name the columns on screen.
 */
function Ruler({
  ticks,
  bands,
  range,
  today,
  zoom,
}: {
  ticks: ReturnType<typeof ticksFor>;
  bands: ReturnType<typeof bandsFor>;
  range: Range;
  today: IsoDate;
  zoom: Zoom;
}) {
  const chart = useContext(ChartContext);
  const viewport = useSyncExternalStore(
    chart.viewport.subscribe,
    chart.viewport.getSnapshot,
    chart.viewport.getSnapshot,
  );
  const visible = useMemo(() => {
    if (!viewport) return { ticks, bands };
    // Keep a generous horizontal buffer so a quick drag does not add/remove
    // labels on every tiny scroll. The first frame still renders the complete
    // ruler until the viewport store has its initial snapshot.
    const bufferDays = Math.max(30, Math.ceil(1800 / PX_PER_DAY[zoom]));
    const from = maxDate(range.start, addDays(viewport.from, -bufferDays));
    const to = minDate(range.end, addDays(viewport.to, bufferDays));
    return {
      ticks: ticks.filter((tick) => tick.date >= from && tick.date <= to),
      bands: bands.filter((band) => band.end >= from && band.start <= to),
    };
  }, [bands, range.end, range.start, ticks, viewport, zoom]);

  return (
    <div
      onPointerDown={(event) => {
        if (event.button === LEFT) startRulerPan(event, chart);
        else if (event.button !== MIDDLE) event.stopPropagation();
      }}
      {...hintTarget(RULER_HINTS)}
      // Above the label gutter (z-40), not under it. The gutter is a column of
      // the chart; the ruler is the chart's own header, and a column of course
      // names riding over the dates as you scrolled read as the two layers
      // having been stacked in the wrong order — because they had been.
      className="timeline-chrome timeline-ruler sticky top-0 z-50 border-b border-separator bg-content"
      style={{ height: RULER_HEIGHT }}
    >
      <div className="timeline-zoom-layer absolute inset-0">
        {visible.bands.map((band) => (
          <span
            key={band.key}
            style={{
              left: xCss(band.start, range.start),
              width: widthCss(band.start, band.end),
              height: BAND_HEIGHT,
            }}
            className="absolute top-0 flex items-center overflow-hidden border-r border-separator/60 text-caption font-semibold text-secondary"
          >
            <span className="sticky left-0 truncate px-1.5">{band.label}</span>
          </span>
        ))}
        {visible.ticks.map((tick) => (
          <span
            key={tick.date}
            style={{ left: xCss(tick.date, range.start), top: BAND_HEIGHT, height: TICK_HEIGHT }}
            className={clsx(
              "timeline-tint absolute flex items-center pl-1 text-caption tabular-nums whitespace-nowrap",
              tick.date === today
                ? "font-semibold text-accent"
                : tick.major
                  ? "font-semibold text-secondary"
                  : "text-tertiary",
            )}
          >
            {tick.label}
          </span>
        ))}
        {/* The today chip belongs to the ruler, not to the line it caps: drawn
            on the canvas it scrolled up out of the chart with the lanes, leaving
            the one marker that answers "where is now" off screen. */}
        <span
          aria-hidden="true"
          // Centred on the line it caps, not started at it.
          style={{ left: xCss(today, range.start), height: RULER_HEIGHT }}
          className="pointer-events-none absolute top-0 flex -translate-x-1/2 items-center"
        >
          <span className="rounded-chip bg-accent px-1 text-caption font-semibold text-on-accent">
            Today
          </span>
        </span>
        </div>
    </div>
  );
}

function Rules({ ticks, range, zoom }: { ticks: ReturnType<typeof ticksFor>; range: Range; zoom: Zoom }) {
  // At Day and Week zoom the grid is regular. One painted gradient replaces
  // thousands of absolutely positioned rules without changing the geometry
  // under the bars. Month and Quarter retain their calendar-aware tick nodes.
  if (zoom === "day" || zoom === "week") {
    const unit = zoom === "day" ? 1 : 7;
    const step = `calc(var(${DAY_WIDTH_PROPERTY}) * ${unit})`;
    const line = `calc(var(${DAY_WIDTH_PROPERTY}) * ${unit} - 1px)`;
    return (
      <div
        aria-hidden="true"
        className="timeline-zoom-layer pointer-events-none absolute inset-0"
        style={{
          top: RULER_HEIGHT,
          backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${line}, color-mix(in srgb, var(--mac-separator) 40%, transparent) ${line}, color-mix(in srgb, var(--mac-separator) 40%, transparent) ${step})`,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="timeline-zoom-layer pointer-events-none absolute inset-0"
      style={{ top: RULER_HEIGHT }}
    >
      {ticks.map((tick) => (
        <span
          key={tick.date}
          style={{ left: xCss(tick.date, range.start) }}
          className={clsx("absolute inset-y-0 w-px", tick.major ? "bg-separator" : "bg-separator/40")}
        />
      ))}
    </div>
  );
}

/**
 * Weekends.
 *
 * Only where a day is wide enough to be a column of its own: at Month and
 * Quarter a two-day stripe every 35 pixels is moiré, not information.
 */
function Weekends({ range, zoom }: { range: Range; zoom: Zoom }) {
  if (zoom !== "day" && zoom !== "week") return null;
  const firstWeekday = weekdayOf(range.start);
  const weekend = "color-mix(in srgb, var(--mac-fill) 50%, transparent)";
  const stops = Array.from({ length: 7 }, (_, offset) => {
    const weekday = (firstWeekday + offset) % 7;
    const color = weekday === 0 || weekday === 6 ? weekend : "transparent";
    return `${color} ${daysCss(offset)}, ${color} ${daysCss(offset + 1)}`;
  }).join(", ");

  return (
    <div
      aria-hidden="true"
      className="timeline-zoom-layer pointer-events-none absolute inset-0"
      style={{
        top: RULER_HEIGHT,
        backgroundImage: `linear-gradient(to right, ${stops})`,
        backgroundSize: `${daysCss(7)} 100%`,
        backgroundRepeat: "repeat-x",
      }}
    />
  );
}

/**
 * What the marks mean.
 *
 * Three of the chart's conventions are unguessable — a dashed outline, a
 * hatched band, a hollow tail on a bar — and each was previously discoverable
 * only by having written the code.
 */
function Legend() {
  return (
    <div className="flex items-center gap-3 text-caption whitespace-nowrap text-tertiary">
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-4 rounded-chip bg-secondary/25">
          <span className="block h-full w-1/2 rounded-chip bg-secondary/70" />
        </span>
        done
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-4 rounded-chip border border-dashed border-tertiary" />
        manual
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-4 rounded-chip bg-negative/30" />
        overdue
      </span>
    </div>
  );
}

function TodayLine({ today, range }: { today: IsoDate; range: Range }) {
  return (
    <div
      // Announced, because "where am I now" is the first question asked of a
      // chart like this and a blue line says nothing to a screen reader.
      role="separator"
      aria-label={`Today, ${today}`}
      style={{ left: xCss(today, range.start) }}
      // Over the bars, under the label gutter, and with its chip left in the
      // ruler: a marker line drawn through the gutter read as a bug, not a
      // layer, and a chip that scrolled away with the lanes read as neither.
      className="timeline-zoom-layer pointer-events-none absolute inset-y-0 z-30 w-px bg-accent"
    />
  );
}

/**
 * Exams.
 *
 * A confirmed date is a hard rule with a flag. A provisional one is a hatched
 * *band* covering its whole window, because that is what it is: the app has been
 * told the exam falls somewhere in there, and drawing a line would state a day
 * nobody has. Planning still counts backwards from the start of the band.
 */
function ExamMarkers({ courses, range }: { courses: readonly Course[]; range: Range }) {
  return (
    <div
      aria-hidden="true"
      className="timeline-zoom-layer pointer-events-none absolute inset-0 z-10"
      style={{ top: RULER_HEIGHT }}
    >
      {courses.flatMap((course) =>
        course.exams.map((exam) => (
          <span key={exam.id}>
            {exam.status === "provisional" && exam.endDate ? (
              // Faint on purpose. Ten courses' worth of windows at any real
              // strength turns the second half of a semester into wallpaper,
              // and the bars underneath are what the chart is for. The hatching
              // still says "somewhere in here" rather than naming a day.
              <span
                style={{
                  left: xCss(exam.startDate, range.start),
                  width: widthCss(exam.startDate, exam.endDate),
                  backgroundImage: `repeating-linear-gradient(45deg, ${courseColorValue(course.color)} 0 1px, transparent 1px 9px)`,
                  opacity: 0.28,
                }}
                className="absolute inset-y-0"
              />
            ) : null}
            <span
              style={{ left: xCss(exam.startDate, range.start), background: courseColorValue(course.color) }}
              className={clsx(
                "absolute inset-y-0 w-px",
                exam.status === "provisional" ? "opacity-40" : "opacity-60",
              )}
            />
            {/* The flag. A rule alone reads as another bar; the flag is what
                says "this is a deadline, not work". */}
            <span
              style={{ left: xCss(exam.startDate, range.start), background: courseColorValue(course.color) }}
              className={clsx(
                "absolute top-0 h-2 w-2 rounded-br-[3px]",
                exam.status === "provisional" && "opacity-50",
              )}
            />
          </span>
        )),
      )}
    </div>
  );
}

/* ─── Rows arriving and leaving ─────────────────────────────────────────────
 *
 * Filtering in the sidebar takes rows out of the chart and puts them back, and
 * both used to be cuts: the height of the group animated — so the chart made
 * room, visibly — while the label and the bars inside that room appeared and
 * vanished in a single frame. Worse in the arriving direction, because the label
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

// One object per state rather than one per render: a row is memoized on its
// props, and a fresh `{height, visible}` every time would either re-render every
// lane on every render or — comparing by identity — never re-render the one that
// actually moved.
const ROW_COLLAPSED: RowMotion = { height: 0, visible: false };
const ROW_SILENT: RowMotion = { height: ROW_HEIGHT, visible: false };
const ROW_SHOWN: RowMotion = { height: ROW_HEIGHT, visible: true };

function motionOf(phase: RowPhase): RowMotion {
  if (phase === "enter" || phase === "shrink") return ROW_COLLAPSED;
  return phase === "shown" ? ROW_SHOWN : ROW_SILENT;
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

/** The same rows, carrying whatever their topics now say. Nothing arrives or leaves. */
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

function useRowTransitions<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
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
  // the chart re-renders whenever a block moves, and `items` is a fresh array
  // every time.
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
    () => rendered.map(({ key, item, phase }) => ({ key, item, motion: motionOf(phase) })),
    [rendered],
  );
}

/* ─── Lanes ─────────────────────────────────────────────────────────────── */

/** A row in the combined lane is a topic *in a course*: the same topic id twice over. */
const rowKeyOf = (entry: { course: Course; topic: Topic }) => `${entry.course.id}:${entry.topic.id}`;
const topicKeyOf = (topic: Topic) => topic.id;

/**
 * Every topic, in one lane.
 *
 * Not a course — nothing here is stored, nothing can be added to it, and it has
 * no colour of its own. It exists because a plan is scheduled *across* courses:
 * the question "what week is over-committed" cannot be answered by a chart that
 * makes you open one course at a time and remember the last one. Each row keeps
 * its own course's colour and names it, so the combined view stays legible, and
 * every row is the same `TopicLane` as below — the same gestures, the same
 * edits, writing to the same blocks.
 *
 * It sits first and starts open, because it is the view most sessions want.
 */
function AllTopicsLane({
  entries,
  range,
  today,
  selectedId,
  onSelectTopic,
}: {
  entries: readonly { course: Course; topic: Topic }[];
  range: Range;
  today: IsoDate;
  selectedId: string | null;
  onSelectTopic: (course: Course, topic: Topic) => void;
}) {
  const [open, setOpen] = useState(true);
  const disclosure = useDisclosure(open);
  const rows = useRowTransitions(entries, rowKeyOf);
  const rowsRef = useReorderAnimation(rows.map((row) => row.key));
  const span = useMemo(() => rollUpSpan(entries.map((entry) => entry.topic)), [entries]);
  if (rows.length === 0) return null;
  // Summed from the rows that are actually there, including the ones on their
  // way out: the group's height and each row's own height animate as one.
  const rowsHeight = rows.reduce((total, row) => total + row.motion.height, 0) + GROUP_GAP;

  return (
    <section className="border-b border-separator">
      {/* The reorder animation is scoped here rather than to the rows alone:
          a row is its lane *and* its label in the gutter card below, and both
          have to travel together. */}
      <div ref={rowsRef} className="relative">
        <div className="timeline-zoom-layer relative" style={{ height: LANE_HEIGHT }}>
          {span ? (
            // Crossfaded rather than swapped: the roll-up and the rows it rolls
            // up are the same work at two scales, and one replacing the other
            // in a frame reads as the chart having been rebuilt.
            <span
              style={{
                left: xCss(span.start, range.start),
                width: widthCss(span.start, span.end),
              }}
              // Kept, not crossfaded away: the roll-up is the lane's own
              // summary, and it reads as one at both densities.
              className="timeline-tint pointer-events-none absolute top-1.5 h-4 rounded-chip bg-fill-strong"
            />
          ) : null}
        </div>

        <div
          className="timeline-disclosure timeline-zoom-layer"
          style={{ height: disclosure.expanded ? rowsHeight : 0 }}
        >
          {disclosure.mounted
            ? rows.map(({ key, item: { course, topic }, motion }) => (
                <MemoTopicLane
                  key={key}
                  rowKey={key}
                  course={course}
                  topic={topic}
                  range={range}
                  today={today}
                  selected={topic.id === selectedId}
                  motion={motion}
                  onSelect={() => onSelectTopic(course, topic)}
                />
              ))
            : null}
        </div>

        <GutterCard
          open={open}
          onToggle={() => setOpen((current) => !current)}
          icon={<Layers aria-hidden="true" className="size-3 shrink-0 text-tertiary" />}
          name="All courses"
          bold
          trailing={<span className="shrink-0 text-caption tabular-nums text-tertiary">{entries.length}</span>}
          rowsHeight={disclosure.expanded ? rowsHeight : 0}
          rows={
            disclosure.mounted
              ? rows.map(({ key, item: { course, topic }, motion }) => ({
                  key,
                  name: topic.name,
                  dot: courseColorValue(topic.color || course.color),
                  selected: topic.id === selectedId,
                  motion,
                  onSelect: () => onSelectTopic(course, topic),
                }))
              : []
          }
        />
      </div>
    </section>
  );
}

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
function useDisclosure(open: boolean): { mounted: boolean; expanded: boolean } {
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
      // the browser to take that as the transition's start value.
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setExpanded(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
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
function useReorderAnimation(keys: readonly string[]) {
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

function CourseLane({
  course,
  health,
  topics,
  range,
  today,
  selectedId,
  onSelectTopic,
}: {
  course: Course;
  health: CourseHealth | undefined;
  topics: readonly Topic[];
  range: Range;
  today: IsoDate;
  selectedId: string | null;
  onSelectTopic: (topic: Topic) => void;
}) {
  const [open, setOpen] = useState(false);
  const disclosure = useDisclosure(open);
  const rows = useRowTransitions(topics, topicKeyOf);
  const span = useMemo(() => rollUpSpan(topics), [topics]);
  // A course with nothing in it opens onto one line of prose rather than rows,
  // and that line still has to have a height to grow to.
  const rowsHeight =
    rows.length === 0
      ? EMPTY_COURSE_HEIGHT
      : rows.reduce((total, row) => total + row.motion.height, 0) + GROUP_GAP;

  return (
    <section className="border-b border-separator/60">
      <div className="relative">
        <div className="timeline-zoom-layer relative" style={{ height: LANE_HEIGHT }}>
          {span ? (
            // The roll-up: one bar covering everything the course has scheduled,
            // filled by the course's overall progress, fading out as the rows it
            // stands in for take its place.
            <span
              style={{
                left: xCss(span.start, range.start),
                width: widthCss(span.start, span.end),
                background: `color-mix(in srgb, ${courseColorValue(course.color)} 25%, transparent)`,
              }}
              className="timeline-tint pointer-events-none absolute top-1.5 h-4 rounded-chip"
            >
              <span
                className="topic-motion-width block h-full rounded-chip"
                style={{
                  width: `${(health?.progress.ratio ?? 0) * 100}%`,
                  background: courseColorValue(course.color),
                  opacity: 0.8,
                }}
              />
            </span>
          ) : null}
        </div>

        <div
          className="timeline-disclosure timeline-zoom-layer"
          style={{ height: disclosure.expanded ? rowsHeight : 0 }}
        >
          {!disclosure.mounted ? null : rows.length === 0 ? (
            <p className="sticky left-0 max-w-md px-8 pb-2 text-callout text-tertiary">
              This course has no topics yet. Add material in the outline before placing study blocks.
            </p>
          ) : (
            rows.map(({ key, item: topic, motion }) => (
              <MemoTopicLane
                key={key}
                rowKey={key}
                course={course}
                topic={topic}
                range={range}
                today={today}
                selected={topic.id === selectedId}
                motion={motion}
                onSelect={() => onSelectTopic(topic)}
              />
            ))
          )}
        </div>

        <GutterCard
          open={open}
          onToggle={() => setOpen((current) => !current)}
          icon={
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ background: courseColorValue(course.color) }}
            />
          }
          name={course.name}
          trailing={
            health?.pace && !health.pace.onTrack ? <Badge tone="negative">Behind</Badge> : null
          }
          rowsHeight={disclosure.expanded && rows.length > 0 ? rowsHeight : 0}
          rows={
            disclosure.mounted
              ? rows.map(({ key, item: topic, motion }) => ({
                  key,
                  name: topic.name,
                  dot: courseColorValue(topic.color || course.color),
                  selected: topic.id === selectedId,
                  motion,
                  onSelect: () => onSelectTopic(topic),
                }))
              : []
          }
        />
      </div>
    </section>
  );
}

/**
 * One course, one element.
 *
 * The toggle button and its topic names used to be two separate pieces of
 * chrome — a rounded header chip sitting above an independently rounded panel
 * of rows — which looked like two things stacked rather than one thing that
 * opens and closes. This is the single sticky shape both live in: one
 * background, one border, rounded once on the right where the whole shape
 * ends, growing and shrinking as `open` toggles the row list beneath the
 * header rather than swapping between two elements.
 */
function GutterCard({
  open,
  onToggle,
  icon,
  name,
  bold = false,
  trailing,
  rows,
  rowsHeight,
}: {
  open: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  name: string;
  /** "All courses" reads as a heading over the courses beneath it, not as one of them. */
  bold?: boolean;
  trailing?: React.ReactNode;
  rows: readonly {
    key: string;
    name: string;
    dot?: string;
    selected?: boolean;
    /** Where this row is in an arrival or a departure; see "Rows arriving and leaving". */
    motion: RowMotion;
    onSelect?: () => void;
  }[];
  /** Driven by the lane's disclosure, so the card grows in step with the rows beside it. */
  rowsHeight: number;
}) {
  const chart = useContext(ChartContext);

  return (
    // Above the today line (z-30) and below the ruler (z-50): it is chrome
    // sitting in front of the canvas, and a marker line drawn through it read
    // as a bug, not a layer.
    <div className="timeline-chrome pointer-events-none absolute inset-0 z-40">
      <div
        {...hintExcludedScope}
        style={{ width: chart.gutter, height: LANE_HEIGHT + rowsHeight }}
        className="timeline-disclosure timeline-course-panel pointer-events-auto sticky left-0 flex flex-col rounded-r-control border-r border-separator/60"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{ height: LANE_HEIGHT }}
          // No `timeline-tint` here: its hover is a highlight like any other in
          // the chart and lands instantly. The chevron keeps its own, because a
          // chevron turning is motion rather than a highlight.
          className="flex shrink-0 items-center gap-1.5 pr-3 pl-2 text-left hover:bg-fill"
        >
          <ChevronRight
            aria-hidden="true"
            className={clsx(
              "timeline-tint size-3.5 shrink-0 text-tertiary",
              open && "rotate-90",
            )}
          />
          {icon}
          <span className={clsx("min-w-0 flex-1 truncate text-callout", bold ? "font-semibold" : "font-medium")}>
            {name}
          </span>
          {trailing}
        </button>

        {rows.length > 0 ? (
          <div className="flex flex-col pb-1">
            {rows.map((row) => (
              // A label is the row's name *and* the way into the row: reading
              // the chart and asking about one of its topics were two different
              // gestures in two different places, and the name is where the
              // hand already is. Selected, it is the same tint the bars carry.
              <button
                key={row.key}
                type="button"
                // The same key its lane on the canvas carries: the two halves
                // light together and travel together. See `lightRow`.
                data-row-key={row.key}
                onPointerEnter={() => lightRow(row.key, true)}
                onPointerLeave={() => lightRow(row.key, false)}
                onClick={row.onSelect}
                // Selection is blue everywhere in the app; a row selected in
                // its course's own colour said "this course" a second time
                // rather than "this is the one you are looking at".
                aria-current={row.selected ? "true" : undefined}
                data-selected={row.selected ? "true" : undefined}
                // The label fades after the row has made room for it and before
                // the room is taken away again; see "Rows arriving and leaving".
                aria-hidden={row.motion.visible ? undefined : "true"}
                tabIndex={row.motion.visible ? undefined : -1}
                style={
                  {
                    height: row.motion.height,
                    opacity: row.motion.visible ? 1 : 0,
                    [ROW_TINT_PROPERTY]: row.dot,
                  } as React.CSSProperties
                }
                className={clsx(
                  "timeline-row timeline-row-motion flex shrink-0 items-center gap-1.5 pr-2 text-left text-callout text-secondary",
                  row.dot ? "pl-2" : "pl-8",
                )}
              >
                {row.dot ? (
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: row.dot }}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A row lights up whole, from either half of it.
 *
 * A row is two elements in two stacking contexts: the lane on the canvas, and
 * its label in the gutter card drawn over the canvas. A `:hover` rule reaches
 * only whichever half the pointer is actually over, so the highlight stopped
 * dead at the edge of the label panel — and the panel is opaque, so the canvas
 * half was not merely unlit but hidden behind it. Raising the lane's highlight
 * over the panel would only move the problem: it would then sit in front of the
 * bars it is supposed to be behind.
 *
 * So neither half hovers. Both carry the same `data-row-key`, and entering
 * either one lights both — the same shape the selected row already has, which
 * is the one highlight in the chart that was never split in two.
 *
 * Written straight to the DOM: a hover is not worth reconciling 344 lanes for,
 * and it has to be instant.
 */
function lightRow(key: string, hovered: boolean) {
  const halves = document.querySelectorAll<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
  for (const half of halves) half.dataset.hovered = String(hovered);
}

function TopicLane({
  course,
  topic,
  rowKey,
  range,
  today,
  selected,
  motion,
  onSelect,
}: {
  course: Course;
  topic: Topic;
  /** Ties this row to its label in the gutter card; see `lightLabel`. */
  rowKey: string;
  range: Range;
  today: IsoDate;
  selected: boolean;
  /** Where this row is in an arrival or a departure; see "Rows arriving and leaving". */
  motion: RowMotion;
  onSelect: () => void;
}) {
  const chart = useContext(ChartContext);
  const laneRef = useRef<HTMLDivElement>(null);
  const tint = courseColorValue(topic.color || course.color);
  const progress = useMemo(() => topicProgress(topic), [topic]);
  // One pass for the row: each bar is drawn with its share of the topic's
  // progress rather than with all of it. See `blocks.ts`.
  const fills = useMemo(() => fillsByBlock(topic), [topic]);

  /**
   * The right button, on empty lane.
   *
   * Creating is now an explicit act rather than the side effect of a sweep, and
   * a block created from a menu has no drag to take its length from — so it is
   * the single day that was clicked, which is also the smallest thing that can
   * then be dragged wider. If the day is already occupied by one of this topic's
   * own bars — the four pixels of lane above and below a bar are still lane —
   * the menu is that bar's, because that is plainly what was pointed at.
   */
  const openLaneMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const lane = laneRef.current;
    if (!lane) return;
    event.preventDefault();
    event.stopPropagation();

    const bounds = lane.getBoundingClientRect();
    const date = clampDate(
      dateAt(event.clientX - bounds.left, range.start, chart.zoomRef.current),
      range.start,
      range.end,
    );
    const occupying = topic.blocks.find(
      (block) => block.startDate <= date && block.endDate >= date,
    );
    if (occupying) {
      chart.select([occupying.id]);
      chart.openMenu(event, [deleteBlockItem(chart, occupying.id)]);
      return;
    }

    chart.openMenu(event, [
      {
        label: `New block on ${shortDate(date)}`,
        icon: <Plus />,
        onSelect: () => {
          if (!chart.repository) return;
          chart.run(
            chart.repository.createStudyBlock({
              topicId: topic.id,
              startDate: date,
              endDate: date,
              source: "manual",
            }),
          );
        },
      },
    ]);
  };

  return (
    <div
      ref={laneRef}
      data-topic-lane={topic.id}
      // Ties the lane to its label in the gutter card — for the shared
      // highlight, and for the reorder animation that has to move both.
      data-row-key={rowKey}
      data-selected={selected ? "true" : undefined}
      // The hover highlight is the row's own course colour; see `globals.css`.
      style={
        {
          height: motion.height,
          opacity: motion.visible ? 1 : 0,
          [ROW_TINT_PROPERTY]: tint,
        } as React.CSSProperties
      }
      onContextMenu={openLaneMenu}
      onPointerEnter={() => lightRow(rowKey, true)}
      onPointerLeave={() => lightRow(rowKey, false)}
      className="timeline-lane timeline-row-motion relative"
    >
      {/* The row's name now lives in the group's single `GutterCard`, drawn
          once above every row rather than repeated per row here. */}
      {topic.blocks.length > 0 ? <OffscreenMarkers topic={topic} tint={tint} /> : null}
      {topic.blocks.map((block) => (
        <MemoBlockBar
          key={block.id}
          course={course}
          topic={topic}
          block={block}
          fill={fills.get(block.id) ?? 0}
          progress={progress}
          range={range}
          today={today}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/** The one delete item, so the bar's menu and the lane's cannot disagree. */
function deleteBlockItem(chart: Chart, blockId: string): MenuItem {
  return {
    label: "Delete block",
    icon: <Trash2 />,
    danger: true,
    onSelect: () => {
      if (!chart.repository) return;
      chart.selection.set(chart.selection.getSnapshot().filter((id) => id !== blockId));
      chart.run(chart.repository.deleteStudyBlock(blockId));
    },
  };
}

/**
 * "There is more of this row over there."
 *
 * A row whose only block sits three months off screen looks, at a glance,
 * exactly like a row with nothing scheduled at all — and at Day zoom most rows
 * look like that most of the time. The markers pin themselves to the edges of
 * the scrollport with `position: sticky`, count what is out there, and scroll
 * the nearest one *just* into view on the side it was hiding past.
 */
function OffscreenMarkers({ topic, tint }: { topic: Topic; tint: string }) {
  const chart = useContext(ChartContext);
  const markers = useOffscreenMarkerState(topic.blocks, chart.viewport);
  // Both sides stay mounted while the row has anything to point at, and the
  // last thing each pointed at is kept while it fades: an element removed from
  // the DOM cannot animate its own departure.
  const [shown, setShown] = useState(markers);
  if (
    (markers.before && markers.before !== shown.before) ||
    (markers.after && markers.after !== shown.after)
  ) {
    setShown({ before: markers.before ?? shown.before, after: markers.after ?? shown.after });
  }
  if (topic.blocks.length === 0) return null;

  return (
    <>
      {shown.before ? (
        <Marker
          side="left"
          tint={tint}
          visible={markers.before !== null}
          count={shown.before.count}
          date={shown.before.block.endDate}
          topic={topic.name}
          onGo={() => chart.reveal(shown.before!.block, "left")}
        />
      ) : null}
      {shown.after ? (
        <Marker
          side="right"
          tint={tint}
          visible={markers.after !== null}
          count={shown.after.count}
          date={shown.after.block.startDate}
          topic={topic.name}
          onGo={() => chart.reveal(shown.after!.block, "right")}
        />
      ) : null}
    </>
  );
}

type MarkerSide = { count: number; block: StudyBlock } | null;
type OffscreenMarkerState = { before: MarkerSide; after: MarkerSide };

const NO_OFFSCREEN_MARKERS: OffscreenMarkerState = { before: null, after: null };

/** One pass finds both counts and the nearest block in either direction. */
function markersFor(blocks: readonly StudyBlock[], viewport: Viewport): OffscreenMarkerState {
  if (!viewport || blocks.length === 0) return NO_OFFSCREEN_MARKERS;

  let beforeCount = 0;
  let afterCount = 0;
  let nearestBefore: StudyBlock | null = null;
  let nearestAfter: StudyBlock | null = null;

  for (const block of blocks) {
    if (block.endDate < viewport.from) {
      beforeCount += 1;
      if (!nearestBefore || block.endDate > nearestBefore.endDate) nearestBefore = block;
    } else if (block.startDate > viewport.to) {
      afterCount += 1;
      if (!nearestAfter || block.startDate < nearestAfter.startDate) nearestAfter = block;
    }
  }

  if (!nearestBefore && !nearestAfter) return NO_OFFSCREEN_MARKERS;
  return {
    before: nearestBefore ? { count: beforeCount, block: nearestBefore } : null,
    after: nearestAfter ? { count: afterCount, block: nearestAfter } : null,
  };
}

function sameMarkerState(left: OffscreenMarkerState, right: OffscreenMarkerState): boolean {
  return (
    left.before?.count === right.before?.count &&
    left.before?.block === right.before?.block &&
    left.after?.count === right.after?.count &&
    left.after?.block === right.after?.block
  );
}

/**
 * `useSyncExternalStore` only re-renders when a snapshot changes by identity.
 * Reuse the previous result while both off-screen sets are unchanged, so a day
 * crossing in empty canvas costs a few comparisons rather than 344 renders.
 */
function useOffscreenMarkerState(
  blocks: readonly StudyBlock[],
  store: ViewportStore,
): OffscreenMarkerState {
  const cacheRef = useRef<{
    blocks: readonly StudyBlock[];
    viewport: Viewport;
    result: OffscreenMarkerState;
  } | null>(null);

  const getSnapshot = useCallback(() => {
    const viewport = store.getSnapshot();
    const cached = cacheRef.current;
    if (cached?.blocks === blocks && cached.viewport === viewport) return cached.result;

    const selected = markersFor(blocks, viewport);
    const result = cached && sameMarkerState(cached.result, selected) ? cached.result : selected;
    cacheRef.current = { blocks, viewport, result };
    return result;
  }, [blocks, store]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

function Marker({
  side,
  tint,
  visible,
  count,
  date,
  topic,
  onGo,
}: {
  side: "left" | "right";
  tint: string;
  /** Kept mounted while false, so it can fade out rather than vanish. */
  visible: boolean;
  count: number;
  date: IsoDate;
  topic: string;
  onGo: () => void;
}) {
  const chart = useContext(ChartContext);
  const Chevron = side === "left" ? ChevronLeft : ChevronRight;
  const where = side === "left" ? "earlier" : "later";

  return (
    <button
      type="button"
      // A press here is neither a rubber band nor a bar gesture: the marker is
      // chrome sitting over the canvas, and the canvas underneath must not hear
      // about it. Middle-button panning still works, because that is taken on
      // the scrollport's capture phase before this ever runs.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onGo}
      data-visible={visible}
      aria-hidden={!visible}
      tabIndex={visible ? undefined : -1}
      title={`${count} ${where} block${count === 1 ? "" : "s"} for ${topic} — go to ${shortDate(date)}`}
      aria-label={`${count} ${where} block${count === 1 ? "" : "s"} for ${topic}, go to ${shortDate(date)}`}
      // Clear of the shared label column on the left, whatever width it
      // currently is; flush with the right edge of the scrollport on the
      // other side, which tailwind alone can express.
      //
      // In the colour of the work it points at: a row of grey chips down the
      // edge of the chart says only "something is out there", and in the
      // combined lane the useful half of that is *whose*.
      style={{
        ...(side === "left" ? { left: chart.gutter + 4 } : undefined),
        background: `color-mix(in srgb, ${tint} 22%, var(--mac-material-inline))`,
        color: tint,
      }}
      // `mt-1` rather than a sticky `top`: a float sits at the top of the row,
      // and the offset of a sticky element is where it pins against the
      // *scrollport*, not where it sits in its row. The margin puts it on the
      // bars' own centre line, at the bars' own height.
      className={clsx(
        "timeline-chrome timeline-marker timeline-inline sticky z-30 mt-1",
        "flex h-4 items-center gap-0.5 rounded-chip px-1 text-caption font-semibold tabular-nums",
        "hover:brightness-110",
        side === "left" ? "float-left" : "float-right right-1",
      )}
    >
      {side === "left" ? <Chevron aria-hidden="true" className="size-3" /> : null}
      {count}
      {side === "right" ? <Chevron aria-hidden="true" className="size-3" /> : null}
    </button>
  );
}

/* ─── The bar ───────────────────────────────────────────────────────────── */

function BlockBar({
  course,
  topic,
  block,
  fill,
  progress,
  range,
  today,
  selected,
  onSelect,
}: {
  course: Course;
  topic: Topic;
  block: StudyBlock;
  /** This bar's share of the topic's progress, 0–1. See `blocks.ts`. */
  fill: number;
  progress: ReturnType<typeof topicProgress>;
  range: Range;
  today: IsoDate;
  selected: boolean;
  onSelect: () => void;
}) {
  const chart = useContext(ChartContext);
  // Both of these are subscriptions to a store rather than props, so that a
  // selection change or a drag frame repaints the bars it touched and no others.
  const draft = useSyncExternalStore(
    chart.drafts.subscribe,
    () => chart.drafts.spanOf(block.id),
    () => null,
  );
  const barSelection = useSyncExternalStore(
    chart.selection.subscribe,
    () => chart.selection.stateOf(block.id),
    () => null,
  );
  const keyboardMode = useKeyboardMode();
  const barHints = barSelection !== null ? barSelectedHints(keyboardMode) : BAR_HINTS;

  const shown = draft ?? block;
  const unit = UNIT_LABELS[topic.unit].plural;
  const tint = courseColorValue(topic.color || course.color);

  const length = differenceInDays(shown.startDate, shown.endDate) + 1;
  const past = shown.endDate < today;
  // "Finished" and "missed" are not the same past. A window that has closed on
  // unfinished work is the one thing on this chart that needs acting on, and it
  // used to be drawn *fainter* than everything else.
  const overdue = past && (progress.ratio ?? 0) < 1;
  const label = `${shortDate(shown.startDate)} – ${shortDate(shown.endDate)}`;

  return (
    <>
      {/*
        The left button selects and drags; there is no click handler because a
        press that stays under the threshold *is* the tap, and the release that
        decides it may come long after the pointer has left this element.
      */}
      <button
        type="button"
        data-block-id={block.id}
        onPointerDown={(event) => {
          if (event.button === LEFT) startBarGesture(event, chart, "move", block.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          // Right-clicking something unselected acts on it, as it does
          // everywhere: the menu must be about the bar that was pointed at.
          if (chart.selection.stateOf(block.id) === null) chart.select([block.id]);
          chart.openMenu(event, [deleteBlockItem(chart, block.id)]);
        }}
        // Enter and Space still select, because that is a button being pressed
        // rather than a shortcut; the arrow-key nudge is gone with the rest of
        // the app's keyboard bindings.
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          chart.select([block.id]);
          onSelect();
        }}
        {...hintTarget(barHints)}
        // Everything a bar means, spoken. The old bars were `div`s and said
        // nothing at all.
        aria-label={`${topic.name}, ${shown.startDate} to ${shown.endDate}, ${length} day${length === 1 ? "" : "s"}, ${topic.completedUnits} of ${topic.totalUnits} ${unit} done${overdue ? ", overdue" : ""}`}
        // The hover answer to "which days is this?", which previously only a
        // screen reader was told.
        title={`${topic.name}\n${shortDate(shown.startDate)} – ${shortDate(shown.endDate)} · ${length} day${length === 1 ? "" : "s"}\n${topic.completedUnits} of ${topic.totalUnits} ${unit} done${overdue ? " · overdue" : ""}`}
        aria-current={barSelection !== null || selected ? "true" : undefined}
        data-selection={barSelection ?? undefined}
        style={{
          left: xCss(shown.startDate, range.start),
          width: widthCss(shown.startDate, shown.endDate, 6),
          // Overdue is carried by a dense opaque warning hatch rather than a
          // second outline: the red pattern makes missed work unmistakable
          // without making it look like an ordinary red study bar.
          backgroundColor: overdue
            ? "transparent"
            : `color-mix(in srgb, ${tint} 22%, transparent)`,
          backgroundImage: overdue
            ? "repeating-linear-gradient(45deg, color-mix(in srgb, var(--mac-negative) 68%, black) 0 2px, transparent 2px 4px)"
            : undefined,
          // One outline per bar, always. It used to be a ring *and*, on a
          // hand-placed block, a dashed border half a pixel outside it — two
          // edges on a shape four pixels tall, which read as a rendering
          // artefact rather than as the two facts it was trying to state. Drawn
          // inside the bar's own box so a six-pixel block keeps its width, and
          // dashed only when the block is one the scheduler does not own.
          //
          // Selected, that outline is replaced by the accent one — at full
          // strength for the primary bar, the one the inspector is describing,
          // and at half for the rest of the selection. An element has one
          // outline, and while a bar is selected this is the one that matters.
          outline:
            barSelection === "primary"
              ? "2px solid var(--mac-accent)"
              : barSelection === "secondary"
                ? "2px solid color-mix(in srgb, var(--mac-accent) 50%, transparent)"
                : `1px ${block.source === "manual" ? "dashed" : "solid"} color-mix(in srgb, ${tint} 55%, transparent)`,
          outlineOffset: barSelection ? 2 : -1,
        }}
        className={clsx(
          "timeline-bar timeline-tint group absolute top-1 h-4 touch-none overflow-hidden rounded-chip",
          barSelection && "z-10",
        )}
      >
        {/* Progress as an internal fill. Each bar carries its *share* of the
            topic's progress, so a topic split across four windows reads as one
            quantity spread over four bars rather than as four times the work. */}
        <span
          aria-hidden="true"
          className="topic-motion-width block h-full"
          style={{ width: `${fill * 100}%`, background: tint }}
        />
        {/* The dates, in the bar, when there is room for them. A chart of
            anonymous rectangles makes you hover every one to read it back. */}
        <span
          aria-hidden="true"
          className="timeline-bar-label pointer-events-none absolute inset-0 items-center justify-center px-1.5 text-caption tabular-nums whitespace-nowrap text-secondary"
        >
          {label}
        </span>
        {/* The resize edges, shown on hover. There is no mode to reveal them in
            any more, so they appear where the hand already is. */}
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button === LEFT) startBarGesture(event, chart, "start", block.id);
          }}
          {...hintTarget(HANDLE_HINTS)}
          className="timeline-bar-handle timeline-tint absolute inset-y-0 left-0 w-1.5 opacity-0"
          style={{ background: "var(--mac-label-secondary)" }}
        />
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button === LEFT) startBarGesture(event, chart, "end", block.id);
          }}
          {...hintTarget(HANDLE_HINTS)}
          className="timeline-bar-handle timeline-tint absolute inset-y-0 right-0 w-1.5 opacity-0"
          style={{ background: "var(--mac-label-secondary)" }}
        />
      </button>
    </>
  );
}

function sameCourseList(left: readonly Course[], right: readonly Course[]): boolean {
  if (left === right) return true;
  return left.length === right.length && left.every((course, index) => course === right[index]);
}

/** The shell can re-render for a hidden-course toggle without changing chart data. */
const MemoTimelineChart = memo(TimelineChart, (left, right) =>
  sameCourseList(left.courses, right.courses) &&
  left.health === right.health &&
  left.today === right.today &&
  (left.query ?? "") === (right.query ?? "") &&
  left.selectedId === right.selectedId,
);

/**
 * The chart owns a lot of rows, but their data is intentionally stable while a
 * sibling disclosure, hover, or local drag changes. These comparators ignore
 * callback identity because the callbacks are actions over the same stable
 * course/topic ids; the visible selection and data props still invalidate the
 * row when their meaning changes.
 */
const MemoAllTopicsLane = memo(AllTopicsLane, (left, right) =>
  left.entries === right.entries &&
  left.range === right.range &&
  left.today === right.today &&
  left.selectedId === right.selectedId,
);

const MemoCourseLane = memo(CourseLane, (left, right) =>
  left.course === right.course &&
  left.health === right.health &&
  left.topics === right.topics &&
  left.range === right.range &&
  left.today === right.today &&
  left.selectedId === right.selectedId,
);

const MemoTopicLane = memo(TopicLane, (left, right) =>
  left.course === right.course &&
  left.topic === right.topic &&
  left.rowKey === right.rowKey &&
  left.range === right.range &&
  left.today === right.today &&
  left.selected === right.selected &&
  // Compared by identity, which works because each phase has exactly one
  // object; see `motionOf`. A row arriving or leaving is the one case where the
  // lane has to re-render with all of its data unchanged.
  left.motion === right.motion,
);

const MemoBlockBar = memo(BlockBar, (left, right) =>
  left.course === right.course &&
  left.topic === right.topic &&
  left.block === right.block &&
  left.fill === right.fill &&
  left.progress === right.progress &&
  left.range === right.range &&
  left.today === right.today &&
  left.selected === right.selected,
);

/** Where the pointer is, and what the drag under it currently means. */
type Readout = { x: number; y: number; startDate: IsoDate; endDate: IsoDate };

/**
 * The dates under a drag, at the pointer.
 *
 * Fixed rather than absolute so it is never clipped by the scroller, and offset
 * above the cursor so it does not cover the bar it is describing.
 *
 * One element for the whole chart, written to directly. A drag now moves a whole
 * selection, so the readout cannot belong to a bar; and it follows the pointer,
 * so it cannot be React state — an update per frame would reconcile every lane
 * in the plan to move a caption.
 */
let readoutElement: HTMLElement | null = null;

function DragReadout() {
  return (
    <span
      ref={(node) => {
        readoutElement = node;
      }}
      role="status"
      data-visible="false"
      className="timeline-readout material-popover pointer-events-none fixed z-50 -translate-x-1/2 rounded-chip px-1.5 py-0.5 text-caption tabular-nums whitespace-nowrap text-label shadow-popover"
    />
  );
}

function showReadout({ x, y, startDate, endDate }: Readout) {
  if (!readoutElement) return;
  const length = differenceInDays(startDate, endDate) + 1;
  readoutElement.textContent = `${shortDate(startDate)} – ${shortDate(endDate)} · ${length} day${length === 1 ? "" : "s"}`;
  readoutElement.style.left = `${x}px`;
  readoutElement.style.top = `${y - 28}px`;
  readoutElement.dataset.visible = "true";
}

function hideReadout() {
  if (readoutElement) readoutElement.dataset.visible = "false";
}

/** Where a topic's work begins: the earliest block it has, or nothing if it has none. */
function firstBlockStart(topic: Topic): IsoDate | null {
  if (topic.blocks.length === 0) return null;
  return minDate(...topic.blocks.map((block) => block.startDate));
}

/** The span a collapsed lane draws: everything the course has scheduled. */
function rollUpSpan(topics: readonly Topic[]): { start: IsoDate; end: IsoDate } | null {
  const blocks = topics.flatMap((topic) => topic.blocks);
  if (blocks.length === 0) return null;
  return {
    start: minDate(...blocks.map((block) => block.startDate)),
    end: maxDate(...blocks.map((block) => block.endDate)),
  };
}
