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
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePlannerErrors, useRepository } from "@/data/use-repository";
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
  type Course,
  type CourseHealth,
  type IsoDate,
  type StudyBlock,
  type Topic,
} from "@/domain";
import { Badge, Button, EmptyState, SegmentedControl } from "@/ui";
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
  weekendsIn,
  widthCss,
  widthOf,
  xCss,
  xOf,
  ZOOM_LABELS,
  ZOOMS,
  type Zoom,
} from "./geometry";
import { clampToLimits, fillsByBlock, limitsAround, limitsFor, type Span } from "./blocks";
import {
  animateScrollLeft,
  isScrollAnimating,
  motionCurveValue,
  motionDuration,
  prefersReducedMotion,
  stopScrollAnimation,
} from "./motion";
import { topicsForQuery } from "@/features/workspace/scope";

/** The virtual lane's key in the open/closed map. No course can collide with it. */
const ALL_TOPICS = "__all-topics__";

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


/* ─── Modes ─────────────────────────────────────────────────────────────── */

const MODES = ["view", "edit"] as const;
type Mode = (typeof MODES)[number];

const MODE_LABELS: Record<Mode, string> = { view: "View", edit: "Edit" };

/**
 * Which mouse button does what.
 *
 * One button acts, the other one *means*. The left button always performs the
 * gesture; holding the right button says "this next drag is the other mode".
 * That is a change from the right button applying edits directly, which had two
 * problems worth naming: an edit was committed by a button no cursor could
 * describe in advance, and there was no state in which the chart could tell you
 * what a press was about to do before you made it.
 *
 * Held, the right button is a modifier and nothing else — it starts no gesture
 * of its own — so the cursor under it is always the truth about the next click.
 */
const LEFT = 0;
const RIGHT = 2;
/** Bits in `PointerEvent.buttons`, which are not the same numbers as `button`. */
const LEFT_BUTTON_MASK = 1;
const RIGHT_BUTTON_MASK = 2;

/**
 * Whether a gesture is in flight, for the bridge below.
 *
 * Module-level rather than a ref because every gesture in the chart has to
 * report into the same place, and there is one chart.
 */
let gestureActive = false;

/** Whether the current gesture was recovered by the bridge in `TimelineView`. */
let bridged = false;

/** What the chart is doing *now*: the mode, inverted while the right button is held. */
function effectiveMode(mode: Mode, editHeld: boolean): Mode {
  if (!editHeld) return mode;
  return mode === "view" ? "edit" : "view";
}

type Gesture = "pan" | "edit";

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

type Chart = {
  scroller: React.RefObject<HTMLDivElement | null>;
  /** What this press means. `null` for a button that only modifies. */
  gestureFor: (event: { button: number; buttons: number }) => Gesture | null;
  viewport: ViewportStore;
  /** Bring a span just inside the given edge of the scrollport, animated. */
  reveal: (span: Span, side: "left" | "right") => void;
  /** A tap on canvas rather than on anything in it: nothing is selected now. */
  clearSelection: () => void;
  /** The shared label-column width; see "Label gutter" above. */
  gutter: number;
};

const ChartContext = createContext<Chart>({
  scroller: { current: null },
  gestureFor: () => null,
  viewport: EMPTY_VIEWPORT_STORE,
  reveal: () => {},
  clearSelection: () => {},
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
 * Grab-scrolling.
 *
 * The canvas moves under the pointer rather than the pointer picking anything
 * up, which is why the gesture is the same on empty background and on a bar:
 * in view mode a bar is part of the picture, not a handle. A press that never
 * passes the threshold was a click, and taps its target instead — that is how
 * selection survives without a separate click handler.
 */
function startPan(event: React.PointerEvent, chart: Chart, onTap?: () => void) {
  const element = chart.scroller.current;
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  // A hand on the chart outranks anything it was doing by itself.
  stopScrollAnimation(element);

  const button = event.button;
  const originX = event.clientX;
  const originY = event.clientY;
  let lastX = event.clientX;
  let lastY = event.clientY;
  let panning = false;
  gestureActive = true;

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
    // The closed hand, for as long as the hand is closed. Written to the DOM
    // rather than to state: a cursor is not worth reconciling 344 lanes for.
    element.dataset.timelinePanning = "true";
    element.scrollLeft -= pointer.clientX - lastX;
    element.scrollTop -= pointer.clientY - lastY;
    lastX = pointer.clientX;
    lastY = pointer.clientY;
  };

  // Only the button that started this. With the right button held as a
  // modifier there are two buttons down, and releasing the other one is not the
  // end of the gesture.
  const up = (pointer: PointerEvent) => {
    if (pointer.button !== button) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    delete element.dataset.timelinePanning;
    gestureActive = false;
    if (panning) swallowNextClick();
    else onTap?.();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export function TimelineView({
  courses,
  health,
  today,
  query = "",
  selectedId,
  onSelectTopic,
  onClearSelection,
  onGoToOutline,
}: {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  today: IsoDate;
  query?: string;
  selectedId: string | null;
  onSelectTopic: (course: Course, topic: Topic) => void;
  /** Selection is a mode you can leave: see `selectTopic` below. */
  onClearSelection?: () => void;
  onGoToOutline: () => void;
}) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [mode, setMode] = useState<Mode>("view");
  const [open, setOpen] = useState<Record<string, boolean>>({ [ALL_TOPICS]: true });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport] = useState(createViewportStore);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** Where today sat on screen when the zoom gesture began; see `changeZoom`. */
  const zoomFromRef = useRef<{ todayScreenX: number } | null>(null);
  /** The scale being animated *towards*, which `zoom` does not become until it lands. */
  const zoomTargetRef = useRef<Zoom | null>(null);
  const zoomTimerRef = useRef(0);

  // Held, the right button inverts the mode. It is state rather than a ref
  // because the mode control is part of the answer: its selection moves to Edit
  // while the button is down, so the chart says what the next click will do
  // rather than leaving you to remember which button you are holding.
  const [editHeld, setEditHeld] = useState(false);
  const active = effectiveMode(mode, editHeld);

  // Released anywhere, not only over the chart — and dropped on a lost window,
  // which is the one way a held button can end without an event of its own.
  useEffect(() => {
    if (!editHeld) return;
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== RIGHT) return;
      setEditHeld(false);
      // A gesture recovered from `buttons` has no release of its own to wait
      // for if the pointer never moves again — end it with the modifier.
      if (bridged) {
        bridged = false;
        window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: LEFT }));
      }
    };
    const onLost = () => setEditHeld(false);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onLost);
    window.addEventListener("blur", onLost);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onLost);
      window.removeEventListener("blur", onLost);
    };
  }, [editHeld]);

  /**
   * What a press means, decided from the press itself.
   *
   * `buttons` is the state of *every* button at the instant of the event, so a
   * left press made while the right one is held arrives already carrying the
   * modifier. Reading it here rather than from state is what makes this
   * correct no matter what happened to the press that set the modifier — which
   * is a real hazard with the right button, whose press can be consumed by the
   * platform's own menu handling before any listener of ours sees it.
   */
  const gestureFor = useCallback(
    (event: { button: number; buttons: number }): Gesture | null => {
      // The right button only ever means "the other mode"; it performs nothing,
      // so a press of it can never move a bar you were about to read.
      if (event.button !== LEFT) return null;
      const held = (event.buttons & RIGHT_BUTTON_MASK) !== 0;
      return effectiveMode(mode, held) === "edit" ? "edit" : "pan";
    },
    [mode],
  );

  // The canvas is a window onto an unbounded timeline, not a fixed span: a
  // plan has no "first" or "last" day, only days nothing happens to be
  // scheduled on yet. `contentRange` is just enough to fit what is actually
  // there; `extraBefore`/`extraAfter` are scroll-driven padding, grown by
  // `trackVisible` as the edges are approached so the scrollbar never becomes
  // a hard wall with real content — or the labels gutter sitting over it —
  // stuck just past it.
  const contentRange = timelineRange(courses, today);
  const [extraBefore, setExtraBefore] = useState(0);
  const [extraAfter, setExtraAfter] = useState(0);
  /** Days to add to `scrollLeft` once `extraBefore` takes effect, so growing the canvas backward does not visually shift it. */
  const pendingShiftRef = useRef(0);

  const range = useMemo(() => {
    const start = addDays(contentRange.start, -extraBefore);
    const end = addDays(contentRange.end, extraAfter);
    return { start, end, days: differenceInDays(start, end) + 1 };
  }, [contentRange.start, contentRange.end, extraBefore, extraAfter]);

  const width = range.days * PX_PER_DAY[zoom];
  const ticks = ticksFor(range.start, range.end, zoom);
  const bands = bandsFor(range.start, range.end, zoom);

  // Today just clear of the label gutter, not a third of the way in: what is
  // coming is what the chart is for, so the whole width goes to it.
  const todayOffset = () => xOf(today, range.start, zoom) - gutter - REVEAL_PADDING_PX;

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
    // a wide margin, so one extension is enough until the next. Guarded on an
    // actually-scrollable canvas, not just a mounted one — an element that has
    // not been laid out yet reports a zero `scrollWidth`, which reads as "at
    // both edges at once" and would extend on every render.
    if (element.scrollWidth > element.clientWidth) {
      const chunkDays = Math.ceil(EXTEND_CHUNK_PX / PX_PER_DAY[zoom]);
      if (element.scrollLeft < EXTEND_TRIGGER_PX) {
        pendingShiftRef.current += chunkDays * PX_PER_DAY[zoom];
        setExtraBefore((days) => days + chunkDays);
      }
      if (element.scrollWidth - (element.scrollLeft + element.clientWidth) < EXTEND_TRIGGER_PX) {
        setExtraAfter((days) => days + chunkDays);
      }
    }
  }, [range.start, viewport, zoom]);

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
  }, [extraBefore]);

  // Opening on the far left of the canvas — weeks of finished work — made
  // "press Today" the first action of every visit. Do it for them, without the
  // animation, so the first paint is already in the right place.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = todayOffset();
    trackVisible();
    // Mount only: re-running would yank the canvas back while someone reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zooming used to be a teleport twice over: the scroll offset was kept in
  // pixels while the pixels changed meaning, so leaving Week for Day landed you
  // months from where you were looking — and it arrived in one frame, with no
  // way to see that the scale rather than the plan had changed.
  //
  /**
   * The zoom, as a transform — and the transform first.
   *
   * Two earlier attempts animated the *geometry* — a transition on the
   * day-width custom property, then one rAF loop driving width and scroll
   * offset together — and both stuttered, for a reason no amount of tuning
   * fixes: every position in the chart is a `calc()` off that one value, so
   * each frame re-lays-out several thousand absolutely positioned elements,
   * and at Day zoom the ruler alone is a tick per day.
   *
   * So the geometry is not animated at all: the whole zoom is one `scaleX` on
   * the canvas, which the compositor runs without consulting layout even once,
   * at any scale, on any size of plan.
   *
   * A third attempt committed the new scale first and scaled *back* to it. That
   * is the same animation and it looked wrong, because of what happens before
   * it: re-rendering every lane and re-laying-out the canvas at the new day
   * width costs a few hundred milliseconds on a real plan, and all of it landed
   * between the click and the first frame of motion. The control moved, then
   * the chart sat still, then it animated — which reads as the chart having
   * missed the click and caught up late.
   *
   * So the order is inverted. `changeZoom` starts the transform on the click
   * itself, from geometry that already exists, and `zoom` is not committed
   * until the transform has finished travelling — this effect. The re-render is
   * just as expensive, but it now happens against a canvas that is already
   * showing the new scale, where the one frame it costs is invisible: the
   * layout it produces is the transform, resolved.
   *
   * The transform's origin is the today marker, and `scrollLeft` is set here so
   * the marker keeps the screen position it had when the gesture started. The
   * one thing that must not move while the scale changes is the thing you
   * navigate by. The chrome riding on the canvas — the ruler, the label gutter —
   * would be stretched by the same transform, so it steps out and comes back.
   */
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const canvas = canvasRef.current;
    const zoomed = zoomFromRef.current;
    zoomFromRef.current = null;
    zoomTargetRef.current = null;
    if (!element || !canvas || !zoomed) return;

    // The scale is now real geometry, so the transform standing in for it goes.
    canvas.classList.remove("timeline-zooming");
    canvas.style.transition = "";
    canvas.style.transform = "";
    canvas.style.transformOrigin = "";
    element.scrollLeft = xOf(today, range.start, zoom) - zoomed.todayScreenX;
    trackVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  useEffect(() => () => window.clearTimeout(zoomTimerRef.current), []);

  // A sidebar or inspector resize changes the right edge without a scroll.
  // Keep markers correct without making viewport dimensions React state.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(trackVisible);
    observer.observe(element);
    return () => observer.disconnect();
  }, [trackVisible]);

  /**
   * The zoom, started on the click.
   *
   * Everything here reads geometry that is already on screen — today's x at the
   * *committed* scale — so it costs nothing and runs in the click's own frame.
   * The transform is the only thing that moves; `zoom` follows it, `duration`
   * later, in the effect above.
   *
   * Zooming again mid-flight retargets rather than restarting: `zoom` has not
   * changed, so the origin and the geometry under it have not either, and
   * writing a new `scaleX` lets the same transition carry on from wherever it
   * had got to. That is also why the scale is always measured from the
   * committed zoom rather than from the one being left.
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
      return;
    }

    window.clearTimeout(zoomTimerRef.current);
    const todayX = xOf(today, range.start, zoom);
    // Captured once per gesture, not once per click: today does not move while
    // the transform runs — it is the origin — so a second click mid-flight is
    // still aiming at the place the first one started from.
    zoomFromRef.current ??= { todayScreenX: todayX - element.scrollLeft };
    zoomTargetRef.current = next;

    const duration = motionDuration(element);
    canvas.classList.add("timeline-zooming");
    canvas.style.transformOrigin = `${todayX}px top`;
    canvas.style.transition = `transform ${duration}ms ${motionCurveValue(element)}`;
    canvas.style.transform = `scaleX(${PX_PER_DAY[next] / PX_PER_DAY[zoom]})`;
    zoomTimerRef.current = window.setTimeout(() => setZoom(next), duration);
  };

  // Independent of `everyTopic` below on purpose: that array is sorted for
  // display, this only needs to know which names are on screen and open.
  const gutter = useMemo(() => {
    const labels: { text: string; kind: LabelKind }[] = [];
    const perCourse = courses.map((course) => ({ course, topics: topicsForQuery(query, course) }));
    if (perCourse.some(({ topics }) => topics.length > 0)) {
      labels.push({ text: "All courses", kind: "allTopics" });
    }
    const allTopicsOpen = open[ALL_TOPICS] ?? true;
    for (const { course, topics } of perCourse) {
      labels.push({ text: course.name, kind: "course" });
      if (allTopicsOpen) {
        for (const topic of topics) labels.push({ text: topic.name, kind: "topicWithDot" });
      }
      if (open[course.id]) {
        for (const topic of topics) labels.push({ text: topic.name, kind: "topicPlain" });
      }
    }
    return gutterWidth(labels);
  }, [courses, query, open]);

  /**
   * Bring a span just inside an edge, rather than centring it.
   *
   * Centring re-framed the whole chart to show one bar: everything you had been
   * reading left the screen so that the thing you were curious about could sit
   * in the middle. Scrolling exactly far enough keeps the context you already
   * had and adds the bar to it — clear of the label gutter on the left, and of
   * the scrollport's own edge on the right, with room to read either way.
   */
  const reveal = useCallback(
    (span: Span, side: "left" | "right") => {
      const element = scrollRef.current;
      if (!element) return;
      const from = xOf(span.startDate, range.start, zoom);
      const to = from + widthOf(span.startDate, span.endDate, zoom);
      const target =
        side === "left"
          ? from - gutter - REVEAL_PADDING_PX
          : to + REVEAL_PADDING_PX - element.clientWidth;
      // `trackVisible` on arrival, not on the way: the marker you just used is
      // only stale until the scroll lands, and it used to stay on screen until
      // the chart was dragged by hand because nothing recomputed it.
      animateScrollLeft(
        element,
        Math.min(target, Math.max(0, width - element.clientWidth)),
        trackVisible,
      );
    },
    [gutter, range.start, trackVisible, width, zoom],
  );

  /**
   * The press the browser will not deliver.
   *
   * Chromium on Linux treats a held right button as a context menu in progress
   * and swallows every mouse press until it is released — so the left click
   * that the modifier is *for* never reaches the page at all. Cancelling
   * `contextmenu` stops the menu appearing; it does not give the press back.
   *
   * Pointer *moves* are still delivered, and each one carries `buttons`: the
   * state of every button at that moment. So the press is recovered from the
   * first move that reports the left button down, and replayed as a real
   * `pointerdown` on whatever is under the pointer — after which every handler
   * in the chart behaves exactly as it does when the browser cooperates. The
   * release is recovered the same way. Where the press *is* delivered, the
   * gesture is already running by then and this does nothing.
   */

  const bridgeHeldPress = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const held = (event.buttons & RIGHT_BUTTON_MASK) !== 0;
    const pressed = (event.buttons & LEFT_BUTTON_MASK) !== 0;
    setEditHeld(held);
    if (!(event.target instanceof Element)) return;

    if (held && pressed && !gestureActive && !bridged) {
      bridged = true;
      event.target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: LEFT,
          buttons: event.buttons,
          clientX: event.clientX,
          clientY: event.clientY,
          pointerId: event.pointerId,
          pointerType: "mouse",
        }),
      );
    } else if (bridged && !pressed) {
      bridged = false;
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, button: LEFT, buttons: event.buttons }),
      );
    }
  }, []);

  const clearSelection = useCallback(() => onClearSelection?.(), [onClearSelection]);

  /**
   * Selecting is a toggle.
   *
   * The inspector is a mode, and every way into it here — a bar, a label — is
   * also the way out of it, because there was none: once something was
   * selected the only way to see the plan without it was to select something
   * else. A tap on empty canvas does the same, which is the gesture people try
   * first.
   */
  const selectTopic = useCallback(
    (course: Course, topic: Topic) => {
      if (topic.id === selectedId) clearSelection();
      else onSelectTopic(course, topic);
    },
    [clearSelection, onSelectTopic, selectedId],
  );

  const chart = useMemo<Chart>(
    () => ({ scroller: scrollRef, gestureFor, viewport, reveal, clearSelection, gutter }),
    [clearSelection, gestureFor, reveal, viewport, gutter],
  );

  if (courses.length === 0) {
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
  // Chronological, not grouped: the combined lane exists to show the plan as a
  // sequence, and a topic's place in that sequence is where its work *starts* —
  // its earliest block, whatever else it has scheduled later. Topics with
  // nothing scheduled have no place in the order, so they go to the end, where
  // they read as a backlog waiting to be placed.
  const everyTopic = courses
    .flatMap((course) => topicsForQuery(query, course).map((topic) => ({ course, topic })))
    .map((entry) => ({ ...entry, from: firstBlockStart(entry.topic) }))
    .sort((left, right) => {
      if (left.from === right.from) return left.topic.name.localeCompare(right.topic.name);
      if (!left.from) return 1;
      if (!right.from) return -1;
      return compareDates(left.from, right.from);
    });

  const scrollToToday = () => {
    const element = scrollRef.current;
    if (!element) return;
    animateScrollLeft(element, todayOffset(), trackVisible);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-separator px-4 py-2">
        {/* First, and the one filled control on the bar: "where am I now" is the
            question this chart is asked most, and the answer should not have to
            be found among the settings for how it is drawn. */}
        <Button size="sm" variant="accent" leadingIcon={<CalendarDays />} onClick={scrollToToday}>
          Today
        </Button>
        <ZoomControl zoom={zoom} onChange={changeZoom} />
        {/* Shows the mode that is in force, not the one that was chosen: while
            the right button is held the selection moves, and moves back when it
            is let go. */}
        <SegmentedControl<Mode>
          size="sm"
          label="Mode"
          className="timeline-segments"
          value={active}
          onValueChange={setMode}
          segments={MODES.map((candidate) => ({ value: candidate, label: MODE_LABELS[candidate] }))}
        />
        <span className="ml-auto text-callout text-tertiary">
          {active === "view"
            ? "Drag to move around the chart. Hold the right button to edit."
            : "Drag a bar to move it, drag its edge to resize. Hold the right button to move around."}
        </span>
        <Legend />
      </div>

      <ChartContext.Provider value={chart}>
      <div
        ref={scrollRef}
        data-timeline-mode={active}
        // The right button is a modifier here, so the browser's own menu would
        // only ever interrupt the gesture it is modifying.
        onContextMenu={(event) => event.preventDefault()}
        onScroll={trackVisible}
        // Captured rather than bubbled: a bar or a lane under the pointer
        // handles its own press first, and the modifier has to be in force
        // before whatever the *next* press lands on asks what it means.
        onPointerDownCapture={(event) => {
          // Read from `buttons`, the state of every button at this instant,
          // rather than from `button`, the one that just changed: a press of
          // the left button while the right is held has to arrive already
          // knowing the modifier is down, whatever happened to the press that
          // set it. This handler is on the capture phase for the same reason —
          // the bar or lane the press lands on asks what it means afterwards.
          setEditHeld((event.buttons & RIGHT_BUTTON_MASK) !== 0);
          if (event.button === RIGHT) event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (chart.gestureFor(event) === "pan") startPan(event, chart, chart.clearSelection);
        }}
        onPointerMove={bridgeHeldPress}
        className="min-h-0 flex-1 overflow-auto bg-content"
      >
        <div
          ref={canvasRef}
          // Every position below is a `calc()` off this one length, so the
          // transition on `.timeline-canvas` is the whole zoom animation.
          style={
            { width: daysCss(range.days), [DAY_WIDTH_PROPERTY]: `${PX_PER_DAY[zoom]}px` } as React.CSSProperties
          }
          className="timeline-canvas relative"
        >
          <Ruler ticks={ticks} bands={bands} range={range} today={today} />

          {/* Drawn once behind every lane rather than per lane, so the rules are
              continuous down the whole chart instead of restarting at each. */}
          <Weekends range={range} zoom={zoom} />
          <Rules ticks={ticks} range={range} />
          <ExamMarkers courses={courses} range={range} />
          <TodayLine today={today} range={range} />

          <div className="relative">
            <AllTopicsLane
              entries={everyTopic}
              range={range}
              zoom={zoom}
              today={today}
              selectedId={selectedId}
              open={open[ALL_TOPICS] ?? true}
              onToggle={() =>
                setOpen((current) => ({ ...current, [ALL_TOPICS]: !(current[ALL_TOPICS] ?? true) }))
              }
              onSelectTopic={selectTopic}
            />
            {courses.map((course) => (
              <CourseLane
                key={course.id}
                course={course}
                health={health.get(course.id)}
                range={range}
                zoom={zoom}
                today={today}
                query={query}
                selectedId={selectedId}
                open={open[course.id] ?? false}
                onToggle={() =>
                  setOpen((current) => ({ ...current, [course.id]: !current[course.id] }))
                }
                onSelectTopic={(topic) => selectTopic(course, topic)}
              />
            ))}
          </div>
        </div>
      </div>
      </ChartContext.Provider>
    </div>
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
}: {
  ticks: ReturnType<typeof ticksFor>;
  bands: ReturnType<typeof bandsFor>;
  range: Range;
  today: IsoDate;
}) {
  return (
    <div
      // Above the label gutter (z-40), not under it. The gutter is a column of
      // the chart; the ruler is the chart's own header, and a column of course
      // names riding over the dates as you scrolled read as the two layers
      // having been stacked in the wrong order — because they had been.
      className="timeline-chrome sticky top-0 z-50 border-b border-separator bg-content"
      style={{ height: RULER_HEIGHT }}
    >
      {bands.map((band) => (
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
      {ticks.map((tick) => (
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
      {/* The today chip belongs to the ruler, not to the line it caps: drawn on
          the canvas it scrolled up out of the chart with the lanes, leaving the
          one marker that answers "where is now" off screen. */}
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
  );
}

function Rules({ ticks, range }: { ticks: ReturnType<typeof ticksFor>; range: Range }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ top: RULER_HEIGHT }}>
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
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ top: RULER_HEIGHT }}>
      {weekendsIn(range.start, range.end).map((date) => (
        <span
          key={date}
          style={{ left: xCss(date, range.start), width: daysCss(1) }}
          className="absolute inset-y-0 bg-fill/50"
        />
      ))}
    </div>
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
      className="pointer-events-none absolute inset-y-0 z-30 w-px bg-accent"
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
      className="pointer-events-none absolute inset-0 z-10"
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

/* ─── Lanes ─────────────────────────────────────────────────────────────── */

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
  zoom,
  today,
  selectedId,
  open,
  onToggle,
  onSelectTopic,
}: {
  entries: readonly { course: Course; topic: Topic }[];
  range: Range;
  zoom: Zoom;
  today: IsoDate;
  selectedId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelectTopic: (course: Course, topic: Topic) => void;
}) {
  const disclosure = useDisclosure(open);
  const rowsRef = useReorderAnimation(entries.map(({ course, topic }) => `${course.id}:${topic.id}`));
  if (entries.length === 0) return null;
  const span = rollUpSpan(entries.map((entry) => entry.topic));
  const rowsHeight = entries.length * ROW_HEIGHT + GROUP_GAP;

  return (
    <section className="border-b border-separator">
      {/* The reorder animation is scoped here rather than to the rows alone:
          a row is its lane *and* its label in the gutter card below, and both
          have to travel together. */}
      <div ref={rowsRef} className="relative">
        <div className="relative" style={{ height: LANE_HEIGHT }}>
          {span ? (
            // Crossfaded rather than swapped: the roll-up and the rows it rolls
            // up are the same work at two scales, and one replacing the other
            // in a frame reads as the chart having been rebuilt.
            <span
              style={{
                left: xCss(span.start, range.start),
                width: widthCss(span.start, span.end),
              }}
              className={clsx(
                "timeline-tint pointer-events-none absolute top-1.5 h-4 rounded-chip bg-fill-strong",
                disclosure.expanded && "opacity-0",
              )}
            />
          ) : null}
        </div>

        <div
          className="timeline-disclosure"
          style={{ height: disclosure.expanded ? rowsHeight : 0 }}
        >
          {disclosure.mounted
            ? entries.map(({ course, topic }) => (
                <TopicLane
                  key={`${course.id}:${topic.id}`}
                  rowKey={`${course.id}:${topic.id}`}
                  course={course}
                  topic={topic}
                  range={range}
                  zoom={zoom}
                  today={today}
                  selected={topic.id === selectedId}
                  onSelect={() => onSelectTopic(course, topic)}
                />
              ))
            : null}
        </div>

        <GutterCard
          open={open}
          onToggle={onToggle}
          icon={<Layers aria-hidden="true" className="size-3 shrink-0 text-tertiary" />}
          name="All courses"
          bold
          trailing={<span className="shrink-0 text-caption tabular-nums text-tertiary">{entries.length}</span>}
          rowsHeight={disclosure.expanded ? rowsHeight : 0}
          rows={
            disclosure.mounted
              ? entries.map(({ course, topic }) => ({
                  key: `${course.id}:${topic.id}`,
                  name: topic.name,
                  dot: courseColorValue(topic.color || course.color),
                  selected: topic.id === selectedId,
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

    const from = new Map(was.map((key, index) => [key, index]));
    const moved = now
      .map((key, index) => ({ key, by: (from.get(key) ?? index) - index }))
      .filter(({ by }) => by !== 0);
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
  range,
  zoom,
  today,
  query,
  selectedId,
  open,
  onToggle,
  onSelectTopic,
}: {
  course: Course;
  health: CourseHealth | undefined;
  range: Range;
  zoom: Zoom;
  today: IsoDate;
  query: string;
  selectedId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelectTopic: (topic: Topic) => void;
}) {
  const disclosure = useDisclosure(open);
  const topics = topicsForQuery(query, course);
  const span = rollUpSpan(topics);
  // A course with nothing in it opens onto one line of prose rather than rows,
  // and that line still has to have a height to grow to.
  const rowsHeight = topics.length === 0 ? EMPTY_COURSE_HEIGHT : topics.length * ROW_HEIGHT + GROUP_GAP;

  return (
    <section className="border-b border-separator/60">
      <div className="relative">
        <div className="relative" style={{ height: LANE_HEIGHT }}>
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
              className={clsx(
                "timeline-tint pointer-events-none absolute top-1.5 h-4 rounded-chip",
                disclosure.expanded && "opacity-0",
              )}
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

        <div className="timeline-disclosure" style={{ height: disclosure.expanded ? rowsHeight : 0 }}>
          {!disclosure.mounted ? null : topics.length === 0 ? (
            <p className="sticky left-0 max-w-md px-8 pb-2 text-callout text-tertiary">
              This course has no topics yet. Add material in the outline before placing study blocks.
            </p>
          ) : (
            topics.map((topic) => (
              <TopicLane
                key={topic.id}
                rowKey={topic.id}
                course={course}
                topic={topic}
                range={range}
                zoom={zoom}
                today={today}
                selected={topic.id === selectedId}
                onSelect={() => onSelectTopic(topic)}
              />
            ))
          )}
        </div>

        <GutterCard
          open={open}
          onToggle={onToggle}
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
          rowsHeight={disclosure.expanded && topics.length > 0 ? topics.length * ROW_HEIGHT + GROUP_GAP : 0}
          rows={
            disclosure.mounted
              ? topics.map((topic) => ({
                  key: topic.id,
                  name: topic.name,
                  dot: courseColorValue(topic.color || course.color),
                  selected: topic.id === selectedId,
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
        style={{ width: chart.gutter, height: LANE_HEIGHT + rowsHeight }}
        className="timeline-disclosure material-inline pointer-events-auto sticky left-0 flex flex-col rounded-r-control border-r border-separator/60"
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
          <div
            // The rows are chrome, not canvas: dragging here moves the chart,
            // the same as dragging any other piece of the gutter in view mode,
            // rather than starting an edit gesture on whatever date happens to
            // sit beneath it.
            onPointerDown={(event) => {
              if (chart.gestureFor(event) === "pan") startPan(event, chart);
            }}
            className="flex flex-col pb-1"
          >
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
                style={{ height: ROW_HEIGHT }}
                className={clsx(
                  "timeline-row flex shrink-0 items-center gap-1.5 pr-2 text-left text-callout text-secondary",
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
  zoom,
  today,
  selected,
  onSelect,
}: {
  course: Course;
  topic: Topic;
  /** Ties this row to its label in the gutter card; see `lightLabel`. */
  rowKey: string;
  range: Range;
  zoom: Zoom;
  today: IsoDate;
  selected: boolean;
  onSelect: () => void;
}) {
  const chart = useContext(ChartContext);
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const laneRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Span | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);
  const tint = courseColorValue(topic.color || course.color);
  // One pass for the row: each bar is drawn with its share of the topic's
  // progress rather than with all of it. See `blocks.ts`.
  const fills = useMemo(() => fillsByBlock(topic), [topic]);

  const startCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    const lane = laneRef.current;
    if (!lane) return;

    event.preventDefault();
    const bounds = lane.getBoundingClientRect();
    const dateUnderPointer = (clientX: number) =>
      clampDate(dateAt(clientX - bounds.left, range.start, zoom), range.start, range.end);
    const originX = event.clientX;
    const origin = dateUnderPointer(event.clientX);
    // Held inside the gap it started in, for the same reason a move is: two
    // windows over the same days are not a plan, and the row's progress is
    // divided between its bars on the assumption that they are sequential.
    const limits = limitsAround({ startDate: origin, endDate: origin }, topic.blocks);
    let latest: Span = { startDate: origin, endDate: origin };
    // The same threshold the bars use, for the same reason in reverse: a stray
    // click on a lane used to commit a one-day block nobody asked for, and the
    // only way to notice was to find it later and delete it.
    let dragging = false;
    gestureActive = true;

    const move = (pointer: PointerEvent) => {
      if (!dragging && Math.abs(pointer.clientX - originX) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      const current = dateUnderPointer(pointer.clientX);
      latest = clampToLimits(
        clampToLimits(
          { startDate: minDate(origin, current), endDate: maxDate(origin, current) },
          "start",
          limits,
        ),
        "end",
        limits,
      );
      setDraft(latest);
      setReadout({ x: pointer.clientX, y: pointer.clientY, ...latest });
    };

    const up = (pointer: PointerEvent) => {
      if (pointer.button !== event.button) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      gestureActive = false;
      setDraft(null);
      setReadout(null);
      if (!dragging) return;
      run(
        repository.createStudyBlock({
          topicId: topic.id,
          startDate: latest.startDate,
          endDate: latest.endDate,
          source: "manual",
        }),
      );
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={laneRef}
      data-topic-lane={topic.id}
      // Ties the lane to its label in the gutter card — for the shared
      // highlight, and for the reorder animation that has to move both.
      data-row-key={rowKey}
      data-selected={selected ? "true" : undefined}
      onPointerDown={(event) => {
        const gesture = chart.gestureFor(event);
        if (gesture === "edit") startCreate(event);
        else if (gesture === "pan") startPan(event, chart, chart.clearSelection);
      }}
      onPointerEnter={() => lightRow(rowKey, true)}
      onPointerLeave={() => lightRow(rowKey, false)}
      className="timeline-lane relative"
      style={{ height: ROW_HEIGHT }}
      title={`Drag to place a study block for ${topic.name}`}
    >
      {/* The row's name now lives in the group's single `GutterCard`, drawn
          once above every row rather than repeated per row here. */}
      <OffscreenMarkers topic={topic} tint={tint} />
      {draft ? (
        <span
          aria-hidden="true"
          style={{
            left: xCss(draft.startDate, range.start),
            width: widthCss(draft.startDate, draft.endDate, 6),
          }}
          className="pointer-events-none absolute top-1 h-4 rounded-chip border border-dashed border-accent bg-accent/10"
        />
      ) : null}
      <DragReadout readout={readout} />
      {topic.blocks.map((block) => (
        <BlockBar
          key={block.id}
          course={course}
          topic={topic}
          block={block}
          fill={fills.get(block.id) ?? 0}
          range={range}
          zoom={zoom}
          today={today}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
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
      // The lane underneath would read this as the start of a *new block*; the
      // marker is chrome, not canvas. Panning it is still panning the chart,
      // though — these chips are pinned to both edges of the scrollport on
      // every row that has work off screen, and a press that landed on one used
      // to be a press the chart ignored. `startPan` eats the click a real drag
      // would otherwise leave behind, so a tap still goes there and a drag does
      // not.
      onPointerDown={(event) => {
        event.stopPropagation();
        if (chart.gestureFor(event) === "pan") startPan(event, chart);
      }}
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
        "timeline-chrome timeline-marker material-inline sticky z-30 mt-1",
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

type DragMode = "move" | "start" | "end";

function BlockBar({
  course,
  topic,
  block,
  fill,
  range,
  zoom,
  today,
  selected,
  onSelect,
}: {
  course: Course;
  topic: Topic;
  block: StudyBlock;
  /** This bar's share of the topic's progress, 0–1. See `blocks.ts`. */
  fill: number;
  range: Range;
  zoom: Zoom;
  today: IsoDate;
  selected: boolean;
  onSelect: () => void;
}) {
  const chart = useContext(ChartContext);
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const [draft, setDraft] = useState<Span | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  const shown = draft ?? block;
  const progress = topicProgress(topic);
  const unit = UNIT_LABELS[topic.unit].plural;
  const tint = courseColorValue(topic.color || course.color);
  // The neighbours this bar may not be dragged into. Read from the stored
  // blocks rather than from anything in flight: the only bar moving is this one.
  const limits = useMemo(() => limitsFor(block, topic), [block, topic]);

  const commit = (next: Span) => {
    setDraft(null);
    if (next.startDate === block.startDate && next.endDate === block.endDate) return;
    run(
      repository.updateStudyBlock(block.id, {
        startDate: next.startDate,
        endDate: next.endDate,
        plannedUnits: block.plannedUnits,
      }),
    );
  };

  /**
   * One pointer handler for moving and for both edges.
   *
   * The threshold is the whole point: below `DRAG_THRESHOLD_PX` nothing has
   * happened, and the pointerup is left to become a click that opens the
   * popover. That one rule is what the old implementation was missing, and it
   * is why every nudge there turned into a modal.
   */
  const startDrag = (event: React.PointerEvent, mode: DragMode) => {
    event.stopPropagation();

    const originX = event.clientX;
    const origin = { startDate: block.startDate, endDate: block.endDate };
    let dragging = false;
    gestureActive = true;
    let latest = origin;

    const move = (pointer: PointerEvent) => {
      const deltaX = pointer.clientX - originX;
      if (!dragging && Math.abs(deltaX) < DRAG_THRESHOLD_PX) return;
      dragging = true;

      const days = daysMoved(deltaX, zoom);
      if (mode === "move") {
        latest = {
          startDate: addDays(origin.startDate, days),
          endDate: addDays(origin.endDate, days),
        };
      } else if (mode === "start") {
        // Clamped rather than allowed to cross: a block whose start is after its
        // end is not a shorter block, it is a broken one.
        latest = {
          startDate: minDate(addDays(origin.startDate, days), origin.endDate),
          endDate: origin.endDate,
        };
      } else {
        latest = {
          startDate: origin.startDate,
          endDate: maxDate(addDays(origin.endDate, days), origin.startDate),
        };
      }
      // And clamped again against the row's other bars, so a drag stops against
      // its neighbour instead of sliding under it.
      latest = clampToLimits(latest, mode, limits);
      setDraft(latest);
      // Dragging used to be blind: the bar moved, but which days it had landed
      // on was a thing you found out by letting go and reading the inspector.
      setReadout({ x: pointer.clientX, y: pointer.clientY, ...latest });
    };

    const up = (pointer: PointerEvent) => {
      if (pointer.button !== event.button) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      gestureActive = false;
      setReadout(null);
      if (dragging) commit(latest);
      else setDraft(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const nudge = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
      return;
    }
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    // Shift resizes from the end, matching what dragging the right edge does.
    // Both go through the same neighbour clamp a drag does, so the keyboard
    // cannot make an overlap the pointer is prevented from making.
    commit(
      event.shiftKey
        ? clampToLimits(
            { startDate: block.startDate, endDate: maxDate(addDays(block.endDate, step), block.startDate) },
            "end",
            limits,
          )
        : clampToLimits(
            { startDate: addDays(block.startDate, step), endDate: addDays(block.endDate, step) },
            "move",
            limits,
          ),
    );
  };

  const length = differenceInDays(shown.startDate, shown.endDate) + 1;
  const past = shown.endDate < today;
  // "Finished" and "missed" are not the same past. A window that has closed on
  // unfinished work is the one thing on this chart that needs acting on, and it
  // used to be drawn *fainter* than everything else.
  const overdue = past && (progress.ratio ?? 0) < 1;
  const barWidth = Math.max(widthOf(shown.startDate, shown.endDate, zoom), 6);
  // Only when the text will not be a clipped stub. Below this the bar's own
  // length is the only honest label it can carry.
  const label = barWidth >= 64 ? `${shortDate(shown.startDate)} – ${shortDate(shown.endDate)}` : null;

  return (
    <>
      {/*
        Tapping a bar selects it into the inspector; dragging it does whatever
        the current mode says the pressed button does. There is no click
        handler, because the editing button may be the right one, which never
        produces a click — a press that stays under the threshold is the tap.
      */}
      <button
        type="button"
        onPointerDown={(event) => {
          const gesture = chart.gestureFor(event);
          if (gesture === "edit") startDrag(event, "move");
          else if (gesture === "pan") startPan(event, chart, onSelect);
        }}
        onKeyDown={nudge}
        // Everything a bar means, spoken. The old bars were `div`s and said
        // nothing at all.
        aria-label={`${topic.name}, ${shown.startDate} to ${shown.endDate}, ${length} day${length === 1 ? "" : "s"}, ${topic.completedUnits} of ${topic.totalUnits} ${unit} done${overdue ? ", overdue" : ""}`}
        // The hover answer to "which days is this?", which previously only a
        // screen reader was told.
        title={`${topic.name}\n${shortDate(shown.startDate)} – ${shortDate(shown.endDate)} · ${length} day${length === 1 ? "" : "s"}\n${topic.completedUnits} of ${topic.totalUnits} ${unit} done${overdue ? " · overdue" : ""}`}
        aria-current={selected ? "true" : undefined}
        style={{
          left: xCss(shown.startDate, range.start),
          width: widthCss(shown.startDate, shown.endDate, 6),
          // Overdue is carried by the bar's *unfilled* part rather than by an
          // outline: the tinted remainder is exactly the work that was missed,
          // and a red ring on top of the "manual" outline made two conventions
          // fight over the same two pixels.
          background: overdue
            ? "color-mix(in srgb, var(--mac-negative) 20%, transparent)"
            : `color-mix(in srgb, ${tint} 22%, transparent)`,
          // One outline per bar, always. It used to be a ring *and*, on a
          // hand-placed block, a dashed border half a pixel outside it — two
          // edges on a shape four pixels tall, which read as a rendering
          // artefact rather than as the two facts it was trying to state. Drawn
          // inside the bar's own box so a six-pixel block keeps its width, and
          // dashed only when the block is one the scheduler does not own.
          outline: `1px ${block.source === "manual" ? "dashed" : "solid"} color-mix(in srgb, ${tint} 55%, transparent)`,
          outlineOffset: -1,
        }}
        className={clsx(
          "timeline-bar timeline-tint group absolute top-1 h-4 touch-none overflow-hidden rounded-chip",
          // The selection ring replaces the bar's own outline rather than
          // joining it — an element has one outline, and this is the one that
          // matters while it is the thing being inspected.
          selected && "z-10 outline-2! outline-offset-2! outline-[var(--mac-accent)]!",
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
        {label ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center px-1.5 text-caption tabular-nums whitespace-nowrap text-secondary"
          >
            {label}
          </span>
        ) : null}
        {/* Shown, and hit, only in edit mode: in view mode a bar is part of the
            picture rather than a handle, and see `globals.css` for both. */}
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (chart.gestureFor(event) === "edit") startDrag(event, "start");
          }}
          className="timeline-bar-handle timeline-tint absolute inset-y-0 left-0 w-1.5 opacity-0"
          style={{ background: "var(--mac-label-secondary)" }}
        />
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (chart.gestureFor(event) === "edit") startDrag(event, "end");
          }}
          className="timeline-bar-handle timeline-tint absolute inset-y-0 right-0 w-1.5 opacity-0"
          style={{ background: "var(--mac-label-secondary)" }}
        />
      </button>
      <DragReadout readout={readout} />
    </>
  );
}

/** Where the pointer is, and what the drag under it currently means. */
type Readout = { x: number; y: number; startDate: IsoDate; endDate: IsoDate };

/**
 * The dates under a drag, at the pointer.
 *
 * Fixed rather than absolute so it is never clipped by the scroller, and offset
 * above the cursor so it does not cover the bar it is describing.
 */
function DragReadout({ readout }: { readout: Readout | null }) {
  if (!readout) return null;
  const length = differenceInDays(readout.startDate, readout.endDate) + 1;
  return (
    <span
      role="status"
      style={{ left: readout.x, top: readout.y - 28 }}
      className="material-popover pointer-events-none fixed z-50 -translate-x-1/2 rounded-chip px-1.5 py-0.5 text-caption tabular-nums whitespace-nowrap text-label shadow-popover"
    >
      {shortDate(readout.startDate)} – {shortDate(readout.endDate)} · {length} day
      {length === 1 ? "" : "s"}
    </span>
  );
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
