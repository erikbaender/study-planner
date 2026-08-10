import { clsx } from "clsx";
import { ChevronRight, Layers, Plus } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import {
  clampDate,
  courseColorValue,
  topicProgress,
  type Course,
  type CourseHealth,
  type IsoDate,
  type Topic,
} from "@/domain";
import { Badge } from "@/ui";
import {
  dateAt,
  shortDate,
  widthCss,
  xCss,
} from "./geometry";
import { fillsByBlock } from "./blocks";
import { useChart } from "./chart-context";
import { deleteBlockItem, MemoBlockBar, OffscreenMarkers } from "./block-bar";
import {
  GROUP_GAP,
  LANE_HEIGHT,
  EMPTY_COURSE_HEIGHT,
  ROW_TINT_PROPERTY,
  type Range,
} from "./layout";
import { rollUpSpan } from "./spans";
import {
  useDisclosure,
  useReorderAnimation,
  useRowTransitions,
  type RowMotion,
} from "./row-transitions";
import { hintExcludedScope } from "@/features/workspace/hints";
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
  const chart = useChart();

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
  const chart = useChart();
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
/**
 * The chart owns a lot of rows, but their data is intentionally stable while a
 * sibling disclosure, hover, or local drag changes. These comparators ignore
 * callback identity because the callbacks are actions over the same stable
 * course/topic ids; the visible selection and data props still invalidate the
 * row when their meaning changes.
 */
export const MemoAllTopicsLane = memo(AllTopicsLane, (left, right) =>
  left.entries === right.entries &&
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
