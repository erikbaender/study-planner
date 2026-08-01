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
import { CalendarRange, ChevronRight, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { usePlannerErrors, useRepository } from "@/data/use-repository";
import {
  addDays,
  differenceInDays,
  maxDate,
  minDate,
  topicProgress,
  UNIT_LABELS,
  type Course,
  type CourseHealth,
  type Exam,
  type IsoDate,
  type StudyBlock,
  type Topic,
} from "@/domain";
import { Badge, Button, EmptyState, Popover, ProgressBar, SegmentedControl } from "@/ui";
import {
  daysMoved,
  PX_PER_DAY,
  ticksFor,
  timelineRange,
  widthOf,
  xOf,
  ZOOM_LABELS,
  ZOOMS,
  type Zoom,
} from "./geometry";

const LANE_HEIGHT = 28;
const ROW_HEIGHT = 24;
/** Below this the pointer was steadying itself, not dragging. The old code had no threshold at all. */
const DRAG_THRESHOLD_PX = 4;

export function TimelineView({
  courses,
  health,
  today,
  selectedId,
  onSelectTopic,
  onGoToOutline,
}: {
  courses: readonly Course[];
  health: Map<string, CourseHealth>;
  today: IsoDate;
  selectedId: string | null;
  onSelectTopic: (course: Course, topic: Topic) => void;
  onGoToOutline: () => void;
}) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  const range = timelineRange(courses, today);
  const width = range.days * PX_PER_DAY[zoom];
  const ticks = ticksFor(range.start, range.end, zoom);

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

  const scrollToToday = () => {
    const element = scrollRef.current;
    if (!element) return;
    // Today a third of the way in, not centred: what is coming matters more
    // than what is behind, so the larger half of the view is given to it.
    element.scrollTo({
      left: xOf(today, range.start, zoom) - element.clientWidth / 3,
      behavior: "smooth",
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-separator px-4 py-2">
        <SegmentedControl<Zoom>
          size="sm"
          label="Zoom"
          value={zoom}
          onValueChange={setZoom}
          segments={ZOOMS.map((candidate) => ({ value: candidate, label: ZOOM_LABELS[candidate] }))}
        />
        <Button size="sm" onClick={scrollToToday}>
          Today
        </Button>
        <span className="ml-auto text-callout text-tertiary">
          Drag a bar to move it, drag its edge to resize. Arrow keys do the same.
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-content">
        <div style={{ width }} className="relative">
          <Ruler ticks={ticks} range={range} zoom={zoom} />

          {/* Drawn once behind every lane rather than per lane, so the rules are
              continuous down the whole chart instead of restarting at each. */}
          <Rules ticks={ticks} range={range} zoom={zoom} />
          <ExamMarkers courses={courses} range={range} zoom={zoom} />
          <TodayLine today={today} range={range} zoom={zoom} />

          <div className="relative">
            {courses.map((course) => (
              <CourseLane
                key={course.id}
                course={course}
                health={health.get(course.id)}
                range={range}
                zoom={zoom}
                today={today}
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
    </div>
  );
}

/* ─── Chrome ────────────────────────────────────────────────────────────── */

type Range = { start: IsoDate; end: IsoDate; days: number };

function Ruler({ ticks, range, zoom }: { ticks: ReturnType<typeof ticksFor>; range: Range; zoom: Zoom }) {
  return (
    <div className="sticky top-0 z-20 h-7 border-b border-separator bg-content">
      {ticks.map((tick) => (
        <span
          key={tick.date}
          style={{ left: xOf(tick.date, range.start, zoom) }}
          className={clsx(
            "absolute top-0 pl-1 text-caption tabular-nums whitespace-nowrap",
            tick.major ? "font-semibold text-secondary" : "text-tertiary",
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
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 top-7">
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
      className="pointer-events-none absolute inset-y-0 z-30 w-px bg-red"
    >
      <span className="absolute top-0 -left-1 flex h-7 items-center">
        <span className="rounded-chip bg-red px-1 text-caption font-semibold text-white">Today</span>
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
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 top-7 z-10">
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
                  backgroundImage: `repeating-linear-gradient(45deg, ${course.color} 0 1px, transparent 1px 9px)`,
                  opacity: 0.28,
                }}
                className="absolute inset-y-0"
              />
            ) : null}
            <span
              style={{ left: xOf(exam.startDate, range.start, zoom), background: course.color }}
              className={clsx(
                "absolute inset-y-0 w-px",
                exam.status === "provisional" ? "opacity-40" : "opacity-60",
              )}
            />
            {/* The flag. A rule alone reads as another bar; the flag is what
                says "this is a deadline, not work". */}
            <span
              style={{ left: xOf(exam.startDate, range.start, zoom), background: course.color }}
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

function CourseLane({
  course,
  health,
  range,
  zoom,
  today,
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
  selectedId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelectTopic: (topic: Topic) => void;
}) {
  const scheduled = course.topics.filter((topic) => topic.blocks.length > 0);
  const span = rollUpSpan(course);

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
          className="sticky left-0 z-10 flex h-full items-center gap-1.5 rounded-r-control bg-content/90 pr-3 pl-2 text-left backdrop-blur-sm hover:bg-fill"
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
            style={{ background: course.color }}
          />
          <span className="max-w-40 truncate text-callout font-medium">{course.name}</span>
          {health?.pace && !health.pace.onTrack ? (
            <Badge tone="red" variant="outline">
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
              background: `color-mix(in srgb, ${course.color} 25%, transparent)`,
            }}
            className="pointer-events-none absolute top-1.5 h-4 rounded-chip"
          >
            <span
              className="block h-full rounded-chip"
              style={{
                width: `${(health?.progress.ratio ?? 0) * 100}%`,
                background: course.color,
                opacity: 0.8,
              }}
            />
          </span>
        ) : null}
      </div>

      {open ? (
        scheduled.length === 0 ? (
          <p className="sticky left-0 max-w-md px-8 pb-2 text-callout text-tertiary">
            Nothing scheduled in this course yet. Phase 6 plans it automatically; until then, drag
            on a lane to place a block by hand.
          </p>
        ) : (
          <div className="pb-1">
            {scheduled.map((topic) => (
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
  onSelect,
}: {
  course: Course;
  topic: Topic;
  range: Range;
  zoom: Zoom;
  today: IsoDate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="relative" style={{ height: ROW_HEIGHT }}>
      <span className="sticky left-0 z-10 float-left max-w-40 truncate bg-content/80 pr-2 pl-8 text-caption text-tertiary backdrop-blur-sm">
        {topic.name}
      </span>
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
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const [draft, setDraft] = useState<{ startDate: IsoDate; endDate: IsoDate } | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);

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
    if (event.button !== 0) return;
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
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dragging) commit(latest);
      else setDraft(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const nudge = (event: React.KeyboardEvent) => {
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

  return (
    <Popover
      open={popoverOpen}
      onOpenChange={(next) => {
        setPopoverOpen(next);
        if (next) onSelect();
      }}
      side="bottom"
      trigger={
        <button
          type="button"
          onPointerDown={(event) => startDrag(event, "move")}
          onKeyDown={nudge}
          // Everything a bar means, spoken. The old bars were `div`s and said
          // nothing at all.
          aria-label={`${topic.name}, ${shown.startDate} to ${shown.endDate}, ${length} day${length === 1 ? "" : "s"}, ${topic.completedUnits} of ${topic.totalUnits} ${unit} done`}
          style={{
            left: xOf(shown.startDate, range.start, zoom),
            width: Math.max(widthOf(shown.startDate, shown.endDate, zoom), 6),
            background: `color-mix(in srgb, ${topic.color || course.color} 22%, transparent)`,
          }}
          className={clsx(
            "group absolute top-1 h-4 touch-none overflow-hidden rounded-chip",
            "inset-ring inset-ring-[color-mix(in_srgb,currentColor_20%,transparent)]",
            draft ? "cursor-grabbing" : "cursor-grab",
            past && "opacity-60",
            selected && "inset-ring-2 inset-ring-[var(--mac-accent)]",
            // A hand-placed block is never regenerated by Reflow, so it is
            // marked as different from one the scheduler owns.
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
              background: topic.color || course.color,
            }}
          />
          <span
            aria-hidden="true"
            onPointerDown={(event) => startDrag(event, "start")}
            className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
            style={{ background: "var(--mac-label-secondary)" }}
          />
          <span
            aria-hidden="true"
            onPointerDown={(event) => startDrag(event, "end")}
            className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100"
            style={{ background: "var(--mac-label-secondary)" }}
          />
        </button>
      }
    >
      <div className="flex w-64 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-body font-semibold">{topic.name}</h3>
          <p className="text-callout text-tertiary">{course.name}</p>
        </div>
        <ProgressBar
          ratio={progress.ratio}
          label={`${topic.name} progress`}
          tint={topic.color || course.color}
        />
        <p className="text-callout tabular-nums text-secondary">
          {topic.completedUnits} / {topic.totalUnits} {unit}
        </p>
        <p className="text-callout tabular-nums text-secondary">
          {shown.startDate} – {shown.endDate} · {length} day{length === 1 ? "" : "s"}
          {block.source === "manual" ? " · placed by hand" : ""}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              setPopoverOpen(false);
              onSelect();
            }}
          >
            Inspect
          </Button>
          <Button
            size="sm"
            variant="plain"
            className="text-red"
            leadingIcon={<Trash2 />}
            onClick={() => {
              setPopoverOpen(false);
              run(repository.deleteStudyBlock(block.id));
            }}
          >
            Remove
          </Button>
        </div>
      </div>
    </Popover>
  );
}

/** The span a collapsed lane draws: everything the course has scheduled. */
function rollUpSpan(course: Course): { start: IsoDate; end: IsoDate } | null {
  const blocks = course.topics.flatMap((topic) => topic.blocks);
  if (blocks.length === 0) return null;
  return {
    start: minDate(...blocks.map((block) => block.startDate)),
    end: maxDate(...blocks.map((block) => block.endDate)),
  };
}
