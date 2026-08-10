import { clsx } from "clsx";
import { AlertTriangle, ChevronRight, Layers, Plus, Trash2 } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  clampDate,
  courseColorValue,
  topicProgress,
  type Course,
  type CourseHealth,
  type IsoDate,
  type Topic,
} from "@/domain";
import {
  dateAt,
  shortDate,
  widthCss,
  xCss,
} from "./geometry";
import { fillsByBlock } from "./blocks";
import { densityBar, DENSITY_BOX, type DensityBar, type DensitySeries } from "./density";
import { useChart, type Chart } from "./chart-context";
import { deleteBlockItem, MemoBlockBar, OffscreenMarkers } from "./block-bar";
import {
  GROUP_GAP,
  LANE_HEIGHT,
  EMPTY_COURSE_HEIGHT,
  ROW_HEIGHT,
  ROW_TINT_PROPERTY,
  type Range,
} from "./layout";
import { rollUpSpan } from "./spans";
import {
  useDisclosure,
  useReorderAnimation,
  useRowTransitions,
  type RowMotion,
} from "@/ui/row-motion";
import { hintExcludedScope } from "@/features/workspace/hints";
import { overdueBlockCount, overdueBlockCountForTopic } from "@/features/workspace/scope";
import { useWorkspace } from "@/features/workspace/store";
import type { MenuItem } from "@/ui";

/* ─── Making and unmaking the rows themselves ───────────────────────────────
 *
 * The chart could always place work; it could never place the thing the work
 * is *for*. A course with no topics said "add material in the outline" and left
 * you to go and find it, which is the one instruction a view should never have
 * to give about its own contents.
 *
 * So the gutter's names carry the same right button the canvas does. The
 * course's own name offers a topic; a topic's name offers a block on today and
 * the topic's removal. Deleting a topic goes through the app's confirmation —
 * unlike a block, it takes its progress and its whole schedule with it, and
 * there is no undo.
 * ────────────────────────────────────────────────────────────────────────── */

function createTopicIn(chart: Chart, course: Course) {
  if (!chart.repository) return;
  chart.run(
    chart.repository
      .createTopic(course.id, {
        // Named rather than blank: an untitled row among forty is
        // indistinguishable from a rendering bug, and the inspector opens on it
        // with the name field ready to be typed over.
        name: "New topic",
        unit: course.topics.at(-1)?.unit ?? "slides",
        color: course.color,
      })
      .then((id) => useWorkspace.getState().select({ kind: "topic", id })),
  );
}

function addTopicItem(chart: Chart, course: Course): MenuItem {
  return { label: "New topic", icon: <Plus />, onSelect: () => createTopicIn(chart, course) };
}

function topicMenuItems(chart: Chart, topic: Topic, today: IsoDate): readonly MenuItem[] {
  return [
    {
      label: `New block on ${shortDate(today)}`,
      icon: <Plus />,
      onSelect: () => {
        if (!chart.repository) return;
        chart.run(
          chart.repository.createStudyBlock({
            topicId: topic.id,
            startDate: today,
            endDate: today,
            source: "manual",
          }),
        );
      },
    },
    { type: "separator" },
    {
      label: `Delete ${topic.name}`,
      icon: <Trash2 />,
      danger: true,
      onSelect: () => useWorkspace.getState().setPendingDelete({ kind: "topic", id: topic.id }),
    },
  ];
}
/* ─── Lanes ─────────────────────────────────────────────────────────────── */

/**
 * What a collapsed lane draws: not progress, but where the work sits, and whose.
 *
 * The bar covers the group's whole scheduled span. Across it, `densityBar`
 * stacks one band per course — each band as thick as that course's share of the
 * work at that point — and gives each date run a solid opacity, so a crowded
 * fortnight is opaque and a quiet one drops to near the track. Nothing is
 * blended: every colour in the bar is exactly some course's own colour, and a
 * week that is three courses at once is three bands rather than a fourth hue
 * belonging to nobody. Every edge lands on a date and is cut hard.
 *
 * The track underneath is what makes the quiet end of the ramp legible: without
 * it a thin fortnight is indistinguishable from empty lane.
 *
 * Because the edges are hard, an edit that moves one of them would jump. The
 * two drawings crossfade instead; see `useCrossfade`.
 */
function RollUpBar({
  series,
  span,
  range,
  label,
}: {
  series: readonly DensitySeries[];
  span: { start: IsoDate; end: IsoDate };
  range: Range;
  /** What the group is, for the hover and for a screen reader. */
  label: string;
}) {
  const density = useMemo(() => densityBar(series, span), [series, span]);
  const blocks = series.reduce((total, entry) => total + entry.blocks.length, 0);
  const description =
    `${label}\n${blocks} block${blocks === 1 ? "" : "s"} · ${shortDate(span.start)} – ${shortDate(span.end)}` +
    (density.peak
      ? `\nBusiest around ${shortDate(density.peak.date)} · ${density.peak.blocks} at once`
      : "");

  // Compared by what the bar actually draws, not by the identity of the object
  // that describes it: renaming a topic recomputes the density and changes
  // nothing about the picture, and a bar that flickers on a rename is worse
  // than one that never animated at all.
  const painting = useMemo(
    () => density.bands.map((band) => `${band.color}|${band.opacity}|${band.d}`).join("|"),
    [density],
  );
  const { previous, generation, settle } = useCrossfade(density, painting);

  return (
    <span
      role="img"
      aria-label={description.replaceAll("\n", ", ")}
      title={description}
      style={{
        left: xCss(span.start, range.start),
        width: widthCss(span.start, span.end),
      }}
      className="timeline-tint pointer-events-none absolute top-1.5 h-4 overflow-hidden rounded-chip bg-fill"
    >
      {/* The picture as it was before the edit, on its way out. Keyed with the
          generation so a second edit mid-fade restarts from the frame that is
          actually on screen rather than finishing the previous one's journey. */}
      {previous ? (
        <Stack key={`out-${generation}`} density={previous} onDone={settle} leaving />
      ) : null}
      {/* Not animated on the first generation: a bar that fades in every time
          the chart mounts makes opening the timeline feel like a page load. */}
      <Stack key={`in-${generation}`} density={density} arriving={generation > 0} />
    </span>
  );
}

/**
 * One drawing of the bar.
 *
 * Stretched rather than scaled: the geometry is in date space, so the same
 * paths serve every zoom and a zoom change is one width animation on the parent
 * rather than every run recomputed per frame.
 */
function Stack({
  density,
  arriving = false,
  leaving = false,
  onDone,
}: {
  density: DensityBar;
  arriving?: boolean;
  leaving?: boolean;
  onDone?: () => void;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${DENSITY_BOX} ${DENSITY_BOX}`}
      preserveAspectRatio="none"
      onAnimationEnd={leaving ? onDone : undefined}
      className={clsx(
        "block size-full",
        leaving && "absolute inset-0 timeline-rollup-out",
        arriving && "timeline-rollup-in",
      )}
    >
      {density.bands.map((band, index) => (
        <path key={`${band.color}-${index}`} d={band.d} fill={band.color} fillOpacity={band.opacity} />
      ))}
    </svg>
  );
}

function AttentionIndicators({
  behindDays,
  overdueBlocks,
}: {
  behindDays: number | null;
  overdueBlocks: number;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {behindDays !== null ? (
        <span title={`${behindDays} days behind pace`} className="flex size-4 items-center justify-center">
          <AlertTriangle aria-hidden="true" className="size-4 text-warning" strokeWidth={1.5} />
        </span>
      ) : null}
      {overdueBlocks > 0 ? (
        <span
          title={`${overdueBlocks} overdue block${overdueBlocks === 1 ? "" : "s"}`}
          className="flex size-4 items-center justify-center"
        >
          <AlertTriangle aria-hidden="true" className="size-4 text-negative" strokeWidth={1.5} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * Hold on to the last drawing while the next one arrives.
 *
 * `signature` is what counts as a change; `value` is what gets kept. The state
 * is adjusted during render rather than in an effect, so the outgoing copy is
 * mounted in the same commit as the incoming one and there is never a frame
 * showing only one of them.
 */
function useCrossfade<T>(value: T, signature: string) {
  const [state, setState] = useState(() => ({
    signature,
    shown: value,
    previous: null as T | null,
    generation: 0,
  }));

  if (state.signature !== signature) {
    // `shown` is the value from the last committed render, which is what is on
    // screen right now — including when a second edit lands mid-fade, where the
    // thing to fade out is the half-arrived drawing rather than the original.
    setState((current) => ({
      signature,
      shown: value,
      previous: current.shown,
      generation: current.generation + 1,
    }));
  }

  const settle = useCallback(() => {
    setState((current) => (current.previous ? { ...current, previous: null } : current));
  }, []);

  return { previous: state.previous, generation: state.generation, settle };
}

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
  health,
  range,
  today,
  selectedId,
  onSelectTopic,
}: {
  entries: readonly { course: Course; topic: Topic }[];
  health: Map<string, CourseHealth>;
  range: Range;
  today: IsoDate;
  selectedId: string | null;
  onSelectTopic: (course: Course, topic: Topic) => void;
}) {
  const chart = useChart();
  const [open, setOpen] = useState(true);
  const disclosure = useDisclosure(open);
  const rows = useRowTransitions(entries, rowKeyOf, ROW_HEIGHT);
  const rowsRef = useReorderAnimation(rows.map((row) => row.key), ROW_HEIGHT);
  const span = useMemo(() => rollUpSpan(entries.map((entry) => entry.topic)), [entries]);
  // One series per topic, each in its *course's* colour rather than its own:
  // series sharing a colour become one band, so the stack here is one band per
  // course. A topic's private colour is a distinction inside a course, and this
  // lane is the one place the question is which course.
  const series = useMemo(
    () =>
      entries.map(({ course, topic }) => ({
        color: courseColorValue(course.color),
        blocks: topic.blocks,
      })),
    [entries],
  );
  if (rows.length === 0) return null;
  // Summed from the rows that are actually there, including the ones on their
  // way out: the group's height and each row's own height animate as one.
  const rowsHeight = rows.reduce((total, row) => total + row.motion.height, 0) + GROUP_GAP;
  const courseIds = new Set(entries.map(({ course }) => course.id));
  const behindDays = Math.max(
    -1,
    ...[...courseIds]
      .map((courseId) => health.get(courseId)?.pace)
      .filter((pace): pace is NonNullable<CourseHealth["pace"]> => Boolean(pace && !pace.onTrack))
      .map((pace) => pace.daysLate),
  );
  const coursesInEntries = new Map(entries.map(({ course }) => [course.id, course] as const));
  const overdueBlocks = [...coursesInEntries.values()].reduce(
    (total, course) => total + overdueBlockCount(course, today),
    0,
  );

  return (
    <section className="border-b border-separator">
      {/* The reorder animation is scoped here rather than to the rows alone:
          a row is its lane *and* its label in the gutter card below, and both
          have to travel together. */}
      <div ref={rowsRef} className="relative">
        <div className="timeline-zoom-layer relative" style={{ height: LANE_HEIGHT }}>
          {/* Kept, not crossfaded away: the roll-up is the lane's own summary,
              and it reads as one whether or not the rows are open. */}
          {span ? (
            <RollUpBar series={series} span={span} range={range} label="All courses" />
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
          trailing={<AttentionIndicators behindDays={behindDays >= 0 ? behindDays : null} overdueBlocks={overdueBlocks} />}
          rowsHeight={disclosure.expanded ? rowsHeight : 0}
          rows={
            disclosure.mounted
              ? rows.map(({ key, item: { course, topic }, motion }) => ({
                  key,
                  name: topic.name,
                  dot: courseColorValue(course.color),
                  overdue: overdueBlockCountForTopic(topic, today) > 0,
                  selected: topic.id === selectedId,
                  motion,
                  onSelect: () => onSelectTopic(course, topic),
                  onMenu: (event: React.MouseEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    chart.openMenu(event, topicMenuItems(chart, topic, today));
                  },
                }))
              : []
          }
        />
      </div>
    </section>
  );
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
  const chart = useChart();
  const [open, setOpen] = useState(false);
  const disclosure = useDisclosure(open);
  const rows = useRowTransitions(topics, topicKeyOf, ROW_HEIGHT);
  const span = useMemo(() => rollUpSpan(topics), [topics]);
  const openCourseMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    chart.openMenu(event, [addTopicItem(chart, course)]);
  };
  const openTopicMenu = (topic: Topic) => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    chart.openMenu(event, topicMenuItems(chart, topic, today));
  };
  // One series per topic so a topic with its own colour still tints its share,
  // as it does in the rows below.
  const series = useMemo(
    () =>
      topics.map((topic) => ({
        color: courseColorValue(course.color),
        blocks: topic.blocks,
      })),
    [topics, course.color],
  );
  // A course with nothing in it opens onto one line of prose rather than rows,
  // and that line still has to have a height to grow to.
  const rowsHeight =
    rows.length === 0
      ? EMPTY_COURSE_HEIGHT
      : rows.reduce((total, row) => total + row.motion.height, 0) + GROUP_GAP;
  const behindDays = health?.pace && !health.pace.onTrack ? health.pace.daysLate : null;
  const overdueBlocks = overdueBlockCount(course, today);

  return (
    <section className="border-b border-separator/60">
      <div className="relative">
        <div className="timeline-zoom-layer relative" style={{ height: LANE_HEIGHT }}>
          {/* The roll-up: one bar covering everything the course has scheduled,
              shaded by how thickly its blocks fall across that span. */}
          {span ? (
            <RollUpBar series={series} span={span} range={range} label={course.name} />
          ) : null}
        </div>

        <div
          className="timeline-disclosure timeline-zoom-layer"
          style={{ height: disclosure.expanded ? rowsHeight : 0 }}
        >
          {!disclosure.mounted ? null : rows.length === 0 ? (
            <div className="sticky left-0 flex max-w-md flex-col items-start gap-1 px-8 pb-2">
              <p className="text-callout text-tertiary">
                This course has no topics yet.
              </p>
              {/* The instruction used to be "add material in the outline", which
                  sent you somewhere else to fix what you were already looking
                  at. */}
              <button
                type="button"
                onClick={() => createTopicIn(chart, course)}
                className="rounded-chip px-1.5 py-0.5 text-callout text-accent hover:bg-fill"
              >
                Add a topic
              </button>
            </div>
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
          trailing={<AttentionIndicators behindDays={behindDays} overdueBlocks={overdueBlocks} />}
          onMenu={openCourseMenu}
          rowsHeight={disclosure.expanded && rows.length > 0 ? rowsHeight : 0}
          rows={
            disclosure.mounted
              ? rows.map(({ key, item: topic, motion }) => ({
                  key,
                  name: topic.name,
                  dot: courseColorValue(course.color),
                  overdue: overdueBlockCountForTopic(topic, today) > 0,
                  selected: topic.id === selectedId,
                  motion,
                  onSelect: () => onSelectTopic(topic),
                  onMenu: openTopicMenu(topic),
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
  onMenu,
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
  /** The right button on the card's own name; see "Making and unmaking the rows themselves". */
  onMenu?: (event: React.MouseEvent) => void;
  rows: readonly {
    key: string;
    name: string;
    dot?: string;
    overdue?: boolean;
    selected?: boolean;
    /** Where this row is in an arrival or a departure; see "Rows arriving and leaving". */
    motion: RowMotion;
    onSelect?: () => void;
    onMenu?: (event: React.MouseEvent) => void;
  }[];
  /** Driven by the lane's disclosure, so the card grows in step with the rows beside it. */
  rowsHeight: number;
}) {
  const chart = useChart();

  return (
    // Above the today line (z-30) and below the ruler (z-50): it is chrome
    // sitting in front of the canvas, and a marker line drawn through it read
    // as a bug, not a layer.
    <div className="timeline-chrome pointer-events-none absolute inset-0 z-40">
      <div
        {...hintExcludedScope}
        style={{ width: chart.gutter, height: LANE_HEIGHT + rowsHeight }}
        className="timeline-disclosure timeline-course-panel pointer-events-auto sticky left-0 flex flex-col rounded-r-control"
      >
        <button
          type="button"
          onClick={onToggle}
          onContextMenu={onMenu}
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
                onContextMenu={row.onMenu}
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
                {row.overdue ? (
                  <span
                    title="Overdue block"
                    className="flex size-4 shrink-0 items-center justify-center"
                  >
                    <AlertTriangle aria-hidden="true" className="size-4 text-negative" strokeWidth={1.5} />
                  </span>
                ) : null}
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
  const chart = useChart();
  const laneRef = useRef<HTMLDivElement>(null);
  const tint = courseColorValue(course.color);
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
      {topic.blocks.length > 0 ? <OffscreenMarkers topic={topic} tint={tint} today={today} /> : null}
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
/**
 * The chart owns a lot of rows, but their data is intentionally stable while a
 * sibling disclosure, hover, or local drag changes. These comparators ignore
 * callback identity because the callbacks are actions over the same stable
 * course/topic ids; the visible selection and data props still invalidate the
 * row when their meaning changes.
 */
export const MemoAllTopicsLane = memo(AllTopicsLane, (left, right) =>
  left.entries === right.entries &&
  left.health === right.health &&
  left.range === right.range &&
  left.today === right.today &&
  left.selectedId === right.selectedId,
);

export const MemoCourseLane = memo(CourseLane, (left, right) =>
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
