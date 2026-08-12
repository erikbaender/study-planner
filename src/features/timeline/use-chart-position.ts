/**
 * Owns every mechanism that positions the timeline viewport: zoom fading,
 * canvas extension, initial reveal, priming onto Today, and filter anchoring.
 * They cannot be separated because all five write the same `scrollLeft`; if
 * they lived as independent concerns, one could undo another's correction.
 *
 * The shared viewport tracking, geometry mirrors, reveal callback, resize
 * observer, and unmount cleanup live here for the same reason: they are the
 * common positioning machinery those mechanisms coordinate through.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  addDays,
  differenceInDays,
  type Course,
  type IsoDate,
} from "@/domain";
import {
  bandsFor,
  dateAt,
  PX_PER_DAY,
  ticksFor,
  timelineRange,
  widthOf,
  xOf,
  type Band,
  type Tick,
  type Zoom,
} from "./geometry";
import type { Span } from "./blocks";
import {
  animateScrollLeft,
  isScrollAnimating,
  motionDuration,
  prefersReducedMotion,
  stopScrollAnimation,
} from "@/ui/motion";
import { type ViewportStore } from "./chart-context";
import { createRafCoalescer } from "./raf";
import { COURSE_FILTER_WILL_CHANGE } from "@/features/workspace/store";
import { cancelActiveGesture } from "./gestures";
import { useViewFadeHold } from "@/features/shell/view-fade";

/** How close to an edge of the canvas triggers growing it further; see `contentRange`. */
const EXTEND_TRIGGER_PX = 1200;
/** How much canvas one extension adds, comfortably past `EXTEND_TRIGGER_PX` so it does not immediately re-trigger. */
const EXTEND_CHUNK_PX = 6000;
/** Breathing room left between a revealed bar and the edge it was hiding past. */
const REVEAL_PADDING_PX = 24;

type ChartRange = { start: IsoDate; end: IsoDate; days: number };

export type ChartPosition = {
  zoom: Zoom;
  zoomRef: RefObject<Zoom>;
  scrollRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  range: ChartRange;
  ticks: Tick[];
  bands: Band[];
  userNavigatedRef: RefObject<boolean>;
  revealInitialChart: () => void;
  scrollToToday: (animated: boolean) => void;
  handleScroll: () => void;
  changeZoom: (next: Zoom) => void;
  reveal: (span: Span, side: "left" | "right") => void;
};

type ChartPositionOptions = {
  courses: readonly Course[];
  today: IsoDate;
  query: string;
  gutter: number;
  viewport: ViewportStore;
};

export function useChartPosition({
  courses,
  today,
  query,
  gutter,
  viewport,
}: ChartPositionOptions): ChartPosition {
  const [zoom, setZoom] = useState<Zoom>("week");
  const zoomRef = useRef<Zoom>("week");
  const releaseViewFade = useViewFadeHold();
  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const scrollRef = useRef<HTMLDivElement>(null);
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
    // directly avoids reconciling the entire timeline while the view is being
    // presented, and releases the view only after its initial position is set.
    canvasRef.current?.removeAttribute("data-timeline-initializing");
    releaseViewFade();
  }, [releaseViewFade]);

  // The canvas declares its initial hidden state so it is present on the first
  // paint. Once the imperative reveal has happened, remove that declaration
  // again after any commit that may have restored it. This is one layout effect
  // rather than state, so revealing a large chart does not reconcile every row.
  useLayoutEffect(() => {
    if (!clearInitialRevealRef.current) return;
    clearInitialRevealRef.current = false;
    canvasRef.current?.removeAttribute("data-timeline-initializing");
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

  const gutterRef = useRef(gutter);

  const width = useMemo(() => range.days * PX_PER_DAY[zoom], [range.days, zoom]);
  const widthRef = useRef(width);
  useLayoutEffect(() => {
    gutterRef.current = gutter;
    widthRef.current = width;
  }, [gutter, width]);
  const ticks = useMemo(() => ticksFor(range.start, range.end, zoom), [range.start, range.end, zoom]);
  const bands = useMemo(() => bandsFor(range.start, range.end, zoom), [range.start, range.end, zoom]);

  // Today sits just beyond the label gutter with the existing breathing room
  // plus one unit of the active zoom on its left. That small historical window
  // is useful context, and makes the chart's meaningful start explicit: the
  // canvas begins where the gutter ends, not at the covered left edge.
  const todayOffset = useCallback(
    () => xOf(today, range.start, zoom) - gutter - REVEAL_PADDING_PX - PX_PER_DAY[zoom],
    [gutter, range.start, today, zoom],
  );

  const trackVisibleNowRef = useRef<(scrollLeft?: number) => void>(() => {});
  const visibleFrameRef = useRef<ReturnType<typeof createRafCoalescer<number>> | null>(null);

  const trackVisibleNow = useCallback((scrollLeft?: number) => {
    const element = scrollRef.current;
    if (!element) return;
    // Nothing while an animation owns the offset. Recomputing every lane's
    // off-screen markers on each frame of a zoom is most of what made one
    // expensive, and the answer is stale for 240ms rather than wrong: the
    // animation runs this once more when it lands.
    if (isScrollAnimating(element)) return;
    const currentScrollLeft = scrollLeft ?? element.scrollLeft;
    const from = dateAt(currentScrollLeft + gutter, range.start, zoom);
    const to = dateAt(currentScrollLeft + element.clientWidth, range.start, zoom);
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
      if (currentScrollLeft < EXTEND_TRIGGER_PX && !extendingBeforeRef.current) {
        extendingBeforeRef.current = true;
        pendingShiftRef.current += chunkDays * PX_PER_DAY[zoom];
        setExtraBefore((days) => days + chunkDays);
      }
      if (
        element.scrollWidth - (currentScrollLeft + element.clientWidth) < EXTEND_TRIGGER_PX &&
        !extendingAfterRef.current
      ) {
        extendingAfterRef.current = true;
        setExtraAfter((days) => days + chunkDays);
      }
    }
  }, [gutter, range.start, viewport, zoom]);

  useLayoutEffect(() => {
    trackVisibleNowRef.current = trackVisibleNow;
  }, [trackVisibleNow]);

  useLayoutEffect(() => {
    const coalescer = createRafCoalescer((scrollLeft: number) =>
      trackVisibleNowRef.current(scrollLeft),
    );
    visibleFrameRef.current = coalescer;
    return () => {
      coalescer.cancel();
      if (visibleFrameRef.current === coalescer) visibleFrameRef.current = null;
    };
  }, []);

  const trackVisible = useCallback(() => {
    // Immediate callers own a meaningful moment in the interaction; discard a
    // queued scroll pass so it cannot publish an older viewport afterwards.
    visibleFrameRef.current?.cancel();
    trackVisibleNow();
  }, [trackVisibleNow]);

  const scheduleTrackVisible = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    // Keep the last native position, then let one frame do the expensive work.
    visibleFrameRef.current?.schedule(element.scrollLeft);
  }, []);

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
    scheduleTrackVisible();
  }, [scrollToToday, scheduleTrackVisible]);

  // Edge and Chromium-based browsers can restore a previous horizontal
  // scrollLeft after the first layout pass. Give that restoration two frames
  // to finish, then make the initial Today position authoritative. Leave a few
  // more frames for a range extension and its layout correction to commit
  // before releasing the view to fade in; a fixed timeout can release it in
  // between those two writes and make it jump immediately after presentation.
  // This pass is intentionally skipped after the user has touched the chart.
  useEffect(() => {
    // Nothing to position, and nothing to wait for: the view shows its empty
    // state instead of a chart, and that is ready the moment it mounts. Without
    // this the hold on the view's fade would only be let go by its fallback
    // timeout, and an empty timeline would take three quarters of a second to
    // admit it is empty.
    if (courses.length === 0) {
      revealInitialChart();
      return;
    }
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
        // resulting layout and scroll correction are committed before releasing
        // the view to fade into view.
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

  useEffect(() => {
    const element = scrollRef.current;
    const canvas = canvasRef.current;
    return () => {
      window.clearTimeout(zoomTimerRef.current);
      if (filterRestoreFrameRef.current !== null) {
        cancelAnimationFrame(filterRestoreFrameRef.current);
      }
      if (filterRestoreTimeoutRef.current !== null) {
        window.clearTimeout(filterRestoreTimeoutRef.current);
      }
      visibleFrameRef.current?.cancel();
      cancelActiveGesture();
      if (element) stopScrollAnimation(element);
      canvas?.removeAttribute("data-timeline-initializing");
    };
  }, []);

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

  return {
    zoom,
    zoomRef,
    scrollRef,
    canvasRef,
    range,
    ticks,
    bands,
    userNavigatedRef,
    revealInitialChart,
    scrollToToday,
    handleScroll,
    changeZoom,
    reveal,
  };
}
