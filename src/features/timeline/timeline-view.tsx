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
import {
  CalendarDays,
} from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  memo,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  compareDates,
  type Course,
  type CourseHealth,
  type IsoDate,
  type Topic,
} from "@/domain";
import { Button, ContextMenuAt, useKeyboardMode, type MenuItem } from "@/ui";
import {
  daysCss,
  DAY_WIDTH_PROPERTY,
  PX_PER_DAY,
} from "./geometry";
import type { BarTarget } from "./selection";
import {
  ChartContext,
  createDraftStore,
  createSelectionStore,
  createViewportStore,
  type Chart,
} from "./chart-context";
import { gutterWidth, type LabelKind } from "./gutter";
import {
  CHART_HINTS,
  chartSelectedHints,
} from "./hints";
import {
  LEFT,
  MIDDLE,
  startBoxSelect,
  startPan,
} from "./gestures";
import { DragReadout } from "./readout";
import {
  hintScope,
  useViewHints,
} from "@/features/workspace/hints";
import { topicsForQuery } from "@/features/workspace/scope";
import {
  ExamMarkers,
  Legend,
  NoTimelineCourses,
  Ruler,
  Rules,
  TodayLine,
  Weekends,
  ZoomControl,
} from "./chrome";
import { MemoAllTopicsLane, MemoCourseLane } from "./lanes";
import { firstBlockStart } from "./spans";
import { useChartPosition } from "./use-chart-position";
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

  // Independent of `everyTopic` below on purpose: that array is sorted for
  // display, this only needs to know which names are on screen.
  const visibleCourseTopics = useMemo(
    () => courses.map((course) => ({ course, topics: topicsForQuery(query, course) })),
    [courses, query],
  );
  const topicsByCourse = useMemo(
    () => new Map(visibleCourseTopics.map(({ course, topics }) => [course, topics] as const)),
    [visibleCourseTopics],
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
  const {
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
  } = useChartPosition({ courses, today, query, gutter, viewport });

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
    for (const { course, topics } of visibleCourseTopics) {
      for (const topic of topics) {
        for (const block of topic.blocks) entries.set(block.id, { block, topic, course });
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
      onSelectTopicRef.current(primary.course, primary.topic);
    },
    [selection],
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
    [clearSelection, drafts, gutter, openMenu, repository, reveal, run, select, selection, viewport, scrollRef, zoomRef],
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
                topics={topicsByCourse.get(course) ?? []}
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
