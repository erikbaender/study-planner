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
import { CalendarRange, ChevronLeft, ChevronRight, Layers } from "lucide-react";
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
  daysMoved,
  dateAt,
  PX_PER_DAY,
  shortDate,
  ticksFor,
  timelineRange,
  weekendsIn,
  widthOf,
  xOf,
  ZOOM_LABELS,
  ZOOMS,
  type Zoom,
} from "./geometry";
import { topicsForQuery } from "@/features/workspace/scope";

/** The virtual lane's key in the open/closed map. No course can collide with it. */
const ALL_TOPICS = "__all-topics__";

const LANE_HEIGHT = 28;
const ROW_HEIGHT = 24;
/** The two-tier header: a band of months or years over the ticks themselves. */
const BAND_HEIGHT = 18;
const TICK_HEIGHT = 18;
const RULER_HEIGHT = BAND_HEIGHT + TICK_HEIGHT;
/** Below this the pointer was steadying itself, not dragging. The old code had no threshold at all. */
const DRAG_THRESHOLD_PX = 4;

/* ─── Modes ─────────────────────────────────────────────────────────────── */

const MODES = ["view", "edit"] as const;
type Mode = (typeof MODES)[number];

const MODE_LABELS: Record<Mode, string> = { view: "View", edit: "Edit" };

/**
 * Which mouse button does what.
 *
 * The two modes are one implementation with the buttons swapped: whichever
 * button is not navigating is editing. View leads with the left button on
 * navigation because reading a semester is mostly scrolling, and a plan you are
 * only looking at should be impossible to disturb by accident.
 */
const LEFT = 0;
const RIGHT = 2;
const buttonsFor = (mode: Mode) =>
  mode === "view" ? { pan: LEFT, edit: RIGHT } : { pan: RIGHT, edit: LEFT };

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
  pan: number;
  edit: number;
  viewport: ViewportStore;
  centreOn: (date: IsoDate) => void;
};

const ChartContext = createContext<Chart>({
  scroller: { current: null },
  pan: LEFT,
  edit: RIGHT,
  viewport: EMPTY_VIEWPORT_STORE,
  centreOn: () => {},
});

/**
 * Grab-scrolling.
 *
 * The canvas moves under the pointer rather than the pointer picking anything
 * up, which is why the gesture is the same on empty background and on a bar:
 * in view mode a bar is part of the picture, not a handle. A press that never
 * passes the threshold was a click, and taps its target instead — that is how
 * selection survives without a separate click handler, which a right button
 * would never fire anyway.
 */
function startPan(event: React.PointerEvent, chart: Chart, onTap?: () => void) {
  const element = chart.scroller.current;
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();

  const originX = event.clientX;
  const originY = event.clientY;
  const left = element.scrollLeft;
  const top = element.scrollTop;
  let panning = false;

  const move = (pointer: PointerEvent) => {
    const deltaX = pointer.clientX - originX;
    const deltaY = pointer.clientY - originY;
    if (!panning && Math.abs(deltaX) < DRAG_THRESHOLD_PX && Math.abs(deltaY) < DRAG_THRESHOLD_PX) {
      return;
    }
    panning = true;
    element.scrollLeft = left - deltaX;
    element.scrollTop = top - deltaY;
  };

  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (!panning) onTap?.();
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
  onGoToOutline,
}: {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  today: IsoDate;
  query?: string;
  selectedId: string | null;
  onSelectTopic: (course: Course, topic: Topic) => void;
  onGoToOutline: () => void;
}) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [mode, setMode] = useState<Mode>("view");
  const [open, setOpen] = useState<Record<string, boolean>>({ [ALL_TOPICS]: true });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport] = useState(createViewportStore);
  /** The date to re-centre on after a zoom change; see `changeZoom`. */
  const anchorRef = useRef<IsoDate | null>(null);

  const range = timelineRange(courses, today);
  const width = range.days * PX_PER_DAY[zoom];
  const ticks = ticksFor(range.start, range.end, zoom);
  const bands = bandsFor(range.start, range.end, zoom);

  // Today a third of the way in, not centred: what is coming matters more than
  // what is behind, so the larger half of the view is given to it.
  const todayOffset = (client: number) => xOf(today, range.start, zoom) - client / 3;

  const trackVisible = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const from = dateAt(element.scrollLeft, range.start, zoom);
    const to = dateAt(element.scrollLeft + element.clientWidth, range.start, zoom);
    viewport.setSnapshot({ from, to });
  }, [range.start, viewport, zoom]);

  // Opening on the far left of the canvas — weeks of finished work — made
  // "press Today" the first action of every visit. Do it for them, without the
  // animation, so the first paint is already in the right place.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = todayOffset(element.clientWidth);
    trackVisible();
    // Mount only: re-running would yank the canvas back while someone reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zooming used to be a teleport: the scroll offset was kept in pixels while
  // the pixels changed meaning, so leaving Week for Day landed you months from
  // where you were looking. The date under the middle of the viewport is what
  // is actually being held constant, so hold that.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!element || !anchor) return;
    element.scrollLeft = xOf(anchor, range.start, zoom) - element.clientWidth / 2;
    trackVisible();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // A sidebar or inspector resize changes the right edge without a scroll.
  // Keep markers correct without making viewport dimensions React state.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(trackVisible);
    observer.observe(element);
    return () => observer.disconnect();
  }, [trackVisible]);

  const changeZoom = (next: Zoom) => {
    const element = scrollRef.current;
    if (element) {
      anchorRef.current = dateAt(element.scrollLeft + element.clientWidth / 2, range.start, zoom);
    }
    setZoom(next);
  };

  const centreOn = useCallback(
    (date: IsoDate) => {
      const element = scrollRef.current;
      if (!element) return;
      element.scrollTo({
        left: xOf(date, range.start, zoom) - element.clientWidth / 2,
        behavior: "smooth",
      });
    },
    [range.start, zoom],
  );
  const chart = useMemo<Chart>(
    () => ({ scroller: scrollRef, ...buttonsFor(mode), viewport, centreOn }),
    [centreOn, mode, viewport],
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
    element.scrollTo({ left: todayOffset(element.clientWidth), behavior: "smooth" });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-separator px-4 py-2">
        <SegmentedControl<Zoom>
          size="sm"
          label="Zoom"
          value={zoom}
          onValueChange={changeZoom}
          segments={ZOOMS.map((candidate) => ({ value: candidate, label: ZOOM_LABELS[candidate] }))}
        />
        <SegmentedControl<Mode>
          size="sm"
          label="Mode"
          value={mode}
          onValueChange={setMode}
          segments={MODES.map((candidate) => ({ value: candidate, label: MODE_LABELS[candidate] }))}
        />
        <Button size="sm" onClick={scrollToToday}>
          Today
        </Button>
        <span className="ml-auto text-callout text-tertiary">
          {mode === "view"
            ? "Drag to move around the chart. Right-drag to edit a block."
            : "Drag a bar to move it, drag its edge to resize. Right-drag to move around."}
        </span>
        <Legend />
      </div>

      <ChartContext.Provider value={chart}>
      <div
        ref={scrollRef}
        // The chart owns both buttons now, so the browser's own menu would only
        // ever interrupt an edit gesture halfway through.
        onContextMenu={(event) => event.preventDefault()}
        onScroll={trackVisible}
        onPointerDown={(event) => {
          if (event.button === chart.pan) startPan(event, chart);
        }}
        className={clsx(
          "min-h-0 flex-1 overflow-auto bg-content",
          mode === "view" && "cursor-grab",
        )}
      >
        <div style={{ width }} className="relative">
          <Ruler ticks={ticks} bands={bands} range={range} zoom={zoom} today={today} />

          {/* Drawn once behind every lane rather than per lane, so the rules are
              continuous down the whole chart instead of restarting at each. */}
          <Weekends range={range} zoom={zoom} />
          <Rules ticks={ticks} range={range} zoom={zoom} />
          <ExamMarkers courses={courses} range={range} zoom={zoom} />
          <TodayLine today={today} range={range} zoom={zoom} />

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
              onSelectTopic={onSelectTopic}
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
                onSelectTopic={(topic) => onSelectTopic(course, topic)}
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
  zoom,
  today,
}: {
  ticks: ReturnType<typeof ticksFor>;
  bands: ReturnType<typeof bandsFor>;
  range: Range;
  zoom: Zoom;
  today: IsoDate;
}) {
  return (
    <div
      className="sticky top-0 z-20 border-b border-separator bg-content"
      style={{ height: RULER_HEIGHT }}
    >
      {bands.map((band) => (
        <span
          key={band.key}
          style={{
            left: xOf(band.start, range.start, zoom),
            width: widthOf(band.start, band.end, zoom),
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
          style={{ left: xOf(tick.date, range.start, zoom), top: BAND_HEIGHT, height: TICK_HEIGHT }}
          className={clsx(
            "absolute flex items-center pl-1 text-caption tabular-nums whitespace-nowrap",
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
    </div>
  );
}

function Rules({ ticks, range, zoom }: { ticks: ReturnType<typeof ticksFor>; range: Range; zoom: Zoom }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ top: RULER_HEIGHT }}>
      {ticks.map((tick) => (
        <span
          key={tick.date}
          style={{ left: xOf(tick.date, range.start, zoom) }}
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
          style={{ left: xOf(date, range.start, zoom), width: PX_PER_DAY[zoom] }}
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

function TodayLine({ today, range, zoom }: { today: IsoDate; range: Range; zoom: Zoom }) {
  return (
    <div
      // Announced, because "where am I now" is the first question asked of a
      // chart like this and a red line says nothing to a screen reader.
      role="separator"
      aria-label={`Today, ${today}`}
      style={{ left: xOf(today, range.start, zoom) }}
      // Above the ruler rather than under it: the chip is the one label that
      // must never be occluded, and the ruler is sticky at z-20.
      className="pointer-events-none absolute inset-y-0 z-30 w-px bg-accent"
    >
      <span className="absolute top-0 -left-1 flex items-center" style={{ height: RULER_HEIGHT }}>
        <span className="rounded-chip bg-accent px-1 text-caption font-semibold text-on-accent">Today</span>
      </span>
    </div>
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
function ExamMarkers({ courses, range, zoom }: { courses: readonly Course[]; range: Range; zoom: Zoom }) {
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
                  left: xOf(exam.startDate, range.start, zoom),
                  width: widthOf(exam.startDate, exam.endDate, zoom),
                  backgroundImage: `repeating-linear-gradient(45deg, ${courseColorValue(course.color)} 0 1px, transparent 1px 9px)`,
                  opacity: 0.28,
                }}
                className="absolute inset-y-0"
              />
            ) : null}
            <span
              style={{ left: xOf(exam.startDate, range.start, zoom), background: courseColorValue(course.color) }}
              className={clsx(
                "absolute inset-y-0 w-px",
                exam.status === "provisional" ? "opacity-40" : "opacity-60",
              )}
            />
            {/* The flag. A rule alone reads as another bar; the flag is what
                says "this is a deadline, not work". */}
            <span
              style={{ left: xOf(exam.startDate, range.start, zoom), background: courseColorValue(course.color) }}
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
  if (entries.length === 0) return null;
  const span = rollUpSpan(entries.map((entry) => entry.topic));

  return (
    <section className="border-b border-separator">
      <div className="relative flex items-center" style={{ height: LANE_HEIGHT }}>
        <button
          type="button"
          onClick={onToggle}
          onPointerDown={(event) => event.stopPropagation()}
          aria-expanded={open}
          className="material-inline sticky left-0 z-10 flex h-full items-center gap-1.5 rounded-r-control border-r border-separator/60 pr-3 pl-2 text-left hover:bg-fill"
        >
          <ChevronRight
            aria-hidden="true"
            className={clsx(
              "size-3.5 shrink-0 text-tertiary transition-transform duration-150 ease-mac",
              open && "rotate-90",
            )}
          />
          <Layers aria-hidden="true" className="size-3 shrink-0 text-tertiary" />
          <span className="text-callout font-semibold">All topics</span>
          <span className="text-caption tabular-nums text-tertiary">{entries.length}</span>
        </button>

        {!open && span ? (
          <span
            style={{
              left: xOf(span.start, range.start, zoom),
              width: widthOf(span.start, span.end, zoom),
            }}
            className="pointer-events-none absolute top-1.5 h-4 rounded-chip bg-fill-strong"
          />
        ) : null}
      </div>

      {open ? (
        <div className="pb-1">
          {entries.map(({ course, topic }) => (
            <TopicLane
              key={`${course.id}:${topic.id}`}
              course={course}
              topic={topic}
              range={range}
              zoom={zoom}
              today={today}
              selected={topic.id === selectedId}
              withCourse
              onSelect={() => onSelectTopic(course, topic)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
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
  const topics = topicsForQuery(query, course);
  const span = rollUpSpan(topics);

  return (
    <section className="border-b border-separator/60">
      <div className="relative flex items-center" style={{ height: LANE_HEIGHT }}>
        {/* The lane's label rides the horizontal scroll so it is readable
            wherever the chart has been scrolled to — the alternative is a fixed
            gutter, which costs a third of the canvas at Day zoom. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="material-inline sticky left-0 z-10 flex h-full items-center gap-1.5 rounded-r-control border-r border-separator/60 pr-3 pl-2 text-left hover:bg-fill"
        >
          <ChevronRight
            aria-hidden="true"
            className={clsx(
              "size-3.5 shrink-0 text-tertiary transition-transform duration-150 ease-mac",
              open && "rotate-90",
            )}
          />
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: courseColorValue(course.color) }}
          />
          <span className="max-w-40 truncate text-callout font-medium">{course.name}</span>
          {health?.pace && !health.pace.onTrack ? (
            <Badge tone="negative">
              Behind
            </Badge>
          ) : null}
        </button>

        {!open && span ? (
          // The roll-up: one bar covering everything the course has scheduled,
          // filled by the course's overall progress.
          <span
            style={{
              left: xOf(span.start, range.start, zoom),
              width: widthOf(span.start, span.end, zoom),
              background: `color-mix(in srgb, ${courseColorValue(course.color)} 25%, transparent)`,
            }}
            className="pointer-events-none absolute top-1.5 h-4 rounded-chip"
          >
            <span
              className="block h-full rounded-chip"
              style={{
                width: `${(health?.progress.ratio ?? 0) * 100}%`,
                background: courseColorValue(course.color),
                opacity: 0.8,
              }}
            />
          </span>
        ) : null}
      </div>

      {open ? (
        topics.length === 0 ? (
          <p className="sticky left-0 max-w-md px-8 pb-2 text-callout text-tertiary">
            This course has no topics yet. Add material in the outline before placing study blocks.
          </p>
        ) : (
          <div className="pb-1">
            {topics.map((topic) => (
              <TopicLane
                key={topic.id}
                course={course}
                topic={topic}
                range={range}
                zoom={zoom}
                today={today}
                selected={topic.id === selectedId}
                onSelect={() => onSelectTopic(topic)}
              />
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}

function TopicLane({
  course,
  topic,
  range,
  zoom,
  today,
  selected,
  withCourse = false,
  onSelect,
}: {
  course: Course;
  topic: Topic;
  range: Range;
  zoom: Zoom;
  today: IsoDate;
  selected: boolean;
  /** Name the course too — in the combined lane a bare topic name is ambiguous. */
  withCourse?: boolean;
  onSelect: () => void;
}) {
  const chart = useContext(ChartContext);
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const laneRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ startDate: IsoDate; endDate: IsoDate } | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  const startCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    const lane = laneRef.current;
    if (!lane) return;

    event.preventDefault();
    const bounds = lane.getBoundingClientRect();
    const dateUnderPointer = (clientX: number) =>
      clampDate(dateAt(clientX - bounds.left, range.start, zoom), range.start, range.end);
    const originX = event.clientX;
    const origin = dateUnderPointer(event.clientX);
    let latest = { startDate: origin, endDate: origin };
    // The same threshold the bars use, for the same reason in reverse: a stray
    // click on a lane used to commit a one-day block nobody asked for, and the
    // only way to notice was to find it later and delete it.
    let dragging = false;

    const move = (pointer: PointerEvent) => {
      if (!dragging && Math.abs(pointer.clientX - originX) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      const current = dateUnderPointer(pointer.clientX);
      latest = {
        startDate: minDate(origin, current),
        endDate: maxDate(origin, current),
      };
      setDraft(latest);
      setReadout({ x: pointer.clientX, y: pointer.clientY, ...latest });
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
      onPointerDown={(event) => {
        if (event.button === chart.edit) startCreate(event);
        else if (event.button === chart.pan) startPan(event, chart);
      }}
      className={clsx(
        "relative hover:bg-fill/30",
        chart.edit === LEFT ? "cursor-crosshair" : "cursor-grab",
      )}
      style={{ height: ROW_HEIGHT }}
      title={`Drag to place a study block for ${topic.name}`}
    >
      {/* Centred on the row rather than floated at its top, so it lines up with
          the bar it names; `text-callout` on `text-secondary` rather than a
          10px tertiary, which was too faint to read against a busy canvas. */}
      <span
        // The label is not canvas: an edit gesture starting on it would place a
        // block at whatever date happens to be underneath. Panning still passes
        // through, because the label scrolls with everything else.
        onPointerDown={(event) => {
          if (event.button === chart.edit) event.stopPropagation();
        }}
        // A right edge on the label, so a bar passing under it reads as passing
        // *under something* rather than as a bar that has been cut in half.
        className="material-inline sticky left-0 z-20 float-left flex h-full max-w-44 cursor-default items-center truncate rounded-r-chip border-r border-separator/60 pr-2 pl-8 text-callout text-secondary"
      >
        {withCourse ? (
          <span className="mr-1 shrink-0 truncate text-tertiary">{course.name} ·</span>
        ) : null}
        {topic.name}
      </span>
      <OffscreenMarkers topic={topic} />
      {draft ? (
        <span
          aria-hidden="true"
          style={{
            left: xOf(draft.startDate, range.start, zoom),
            width: Math.max(widthOf(draft.startDate, draft.endDate, zoom), 6),
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
 * the scrollport with `position: sticky`, count what is out there, and take you
 * to the nearest one on the far side, centred rather than flush against an edge
 * so its neighbours come with it.
 */
function OffscreenMarkers({ topic }: { topic: Topic }) {
  const chart = useContext(ChartContext);
  const markers = useOffscreenMarkerState(topic.blocks, chart.viewport);
  if (!markers.before && !markers.after) return null;

  return (
    <>
      {markers.before ? (
        <Marker
          side="left"
          count={markers.before.count}
          date={markers.before.block.endDate}
          topic={topic.name}
          onGo={() => chart.centreOn(midpoint(markers.before!.block))}
        />
      ) : null}
      {markers.after ? (
        <Marker
          side="right"
          count={markers.after.count}
          date={markers.after.block.startDate}
          topic={topic.name}
          onGo={() => chart.centreOn(midpoint(markers.after!.block))}
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
  count,
  date,
  topic,
  onGo,
}: {
  side: "left" | "right";
  count: number;
  date: IsoDate;
  topic: string;
  onGo: () => void;
}) {
  const Chevron = side === "left" ? ChevronLeft : ChevronRight;
  const where = side === "left" ? "earlier" : "later";

  return (
    <button
      type="button"
      // The lane underneath would read this as the start of a pan or of a new
      // block; the marker is chrome, not canvas.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onGo}
      title={`${count} ${where} block${count === 1 ? "" : "s"} for ${topic} — go to ${shortDate(date)}`}
      aria-label={`${count} ${where} block${count === 1 ? "" : "s"} for ${topic}, go to ${shortDate(date)}`}
      className={clsx(
        "material-inline sticky top-1 z-30 flex h-4 items-center gap-0.5 rounded-chip px-1 text-caption tabular-nums text-secondary",
        "hover:text-label",
        // Clear of the sticky label column on the left; flush with the right
        // edge of the scrollport on the other side.
        side === "left" ? "float-left left-44 mr-1" : "float-right right-1",
      )}
    >
      {side === "left" ? <Chevron aria-hidden="true" className="size-3" /> : null}
      {count}
      {side === "right" ? <Chevron aria-hidden="true" className="size-3" /> : null}
    </button>
  );
}

/** The day a block reads as being "at", for centring on it. */
function midpoint(block: StudyBlock): IsoDate {
  return addDays(block.startDate, Math.floor(differenceInDays(block.startDate, block.endDate) / 2));
}

/* ─── The bar ───────────────────────────────────────────────────────────── */

type DragMode = "move" | "start" | "end";

function BlockBar({
  course,
  topic,
  block,
  range,
  zoom,
  today,
  selected,
  onSelect,
}: {
  course: Course;
  topic: Topic;
  block: StudyBlock;
  range: Range;
  zoom: Zoom;
  today: IsoDate;
  selected: boolean;
  onSelect: () => void;
}) {
  const chart = useContext(ChartContext);
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const [draft, setDraft] = useState<{ startDate: IsoDate; endDate: IsoDate } | null>(null);
  const [readout, setReadout] = useState<Readout | null>(null);

  const shown = draft ?? block;
  const progress = topicProgress(topic);
  const unit = UNIT_LABELS[topic.unit].plural;

  const commit = (next: { startDate: IsoDate; endDate: IsoDate }) => {
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
      setDraft(latest);
      // Dragging used to be blind: the bar moved, but which days it had landed
      // on was a thing you found out by letting go and reading the inspector.
      setReadout({ x: pointer.clientX, y: pointer.clientY, ...latest });
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
    commit(
      event.shiftKey
        ? { startDate: block.startDate, endDate: maxDate(addDays(block.endDate, step), block.startDate) }
        : { startDate: addDays(block.startDate, step), endDate: addDays(block.endDate, step) },
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
          if (event.button === chart.edit) startDrag(event, "move");
          else if (event.button === chart.pan) startPan(event, chart, onSelect);
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
          left: xOf(shown.startDate, range.start, zoom),
          width: barWidth,
          // Overdue is carried by the bar's *unfilled* part rather than by an
          // outline: the tinted remainder is exactly the work that was missed,
          // and a red ring on top of the dashed "manual" border made two
          // conventions fight over the same two pixels.
          background: overdue
            ? "color-mix(in srgb, var(--mac-negative) 20%, transparent)"
            : `color-mix(in srgb, ${courseColorValue(topic.color || course.color)} 22%, transparent)`,
        }}
        className={clsx(
          "group absolute top-1 h-4 touch-none overflow-hidden rounded-chip",
          "inset-ring inset-ring-[color-mix(in_srgb,currentColor_20%,transparent)]",
          draft ? "cursor-grabbing" : "cursor-grab",
          // Faded only once it is both past *and* finished: done work should
          // recede, unfinished work in a closed window should not.
          past && !overdue && "opacity-60",
          // An outline outside the bar rather than a ring inside it. The inset
          // version ate two pixels of a bar that can be six wide, and on a short
          // block it was most of what you saw.
          selected && "z-10 outline-2 outline-offset-2 outline-[var(--mac-accent)]",
          // A hand-placed block is never regenerated by Reflow, so it is marked
          // as different from one the scheduler owns.
          block.source === "manual" && "border border-dashed border-[var(--mac-label-tertiary)]",
        )}
      >
        {/* Progress as an internal fill: a half-done topic reads as half-full,
            so the chart answers "am I on top of this", not only "when is it". */}
        <span
          aria-hidden="true"
          className="block h-full"
          style={{
            width: `${(progress.ratio ?? 0) * 100}%`,
            background: courseColorValue(topic.color || course.color),
          }}
        />
        {/* The dates, in the bar, when there is room for them. A chart of
            anonymous rectangles makes you hover every one to read it back. */}
        {label ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center px-1.5 text-caption tabular-nums whitespace-nowrap text-secondary"
          >
            {label}
          </span>
        ) : null}
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button === chart.edit) startDrag(event, "start");
          }}
          className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
          style={{ background: "var(--mac-label-secondary)" }}
        />
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button === chart.edit) startDrag(event, "end");
          }}
          className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
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
