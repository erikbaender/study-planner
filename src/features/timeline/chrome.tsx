import { clsx } from "clsx";
import { memo, useMemo, useState, useSyncExternalStore } from "react";
import {
  addDays,
  courseColorValue,
  maxDate,
  minDate,
  weekdayOf,
  type Course,
  type IsoDate,
} from "@/domain";
import { SegmentedControl } from "@/ui";
import {
  bandsFor,
  daysCss,
  DAY_WIDTH_PROPERTY,
  PX_PER_DAY,
  ticksFor,
  widthCss,
  xCss,
  ZOOM_LABELS,
  ZOOMS,
  type Zoom,
} from "./geometry";
import { useChart } from "./chart-context";
import { LEFT, MIDDLE, startRulerPan } from "./gestures";
import {
  BAND_HEIGHT,
  RULER_HEIGHT,
  TICK_HEIGHT,
  type Range,
} from "./layout";
import { RULER_HINTS } from "./hints";
import { hintTarget } from "@/features/workspace/hints";

/* ─── Chrome ────────────────────────────────────────────────────────────── */

/**
 * Everything below is memoized.
 *
 * One course being filtered now re-renders the chart four times — once for the
 * click and once for each stage of the lane's departure — and the ruler, the
 * weekend shading and the vertical rules are one element per tick across a
 * whole semester. None of them can change while a lane closes, so rebuilding
 * them was the largest remaining cost of the animation. Their props are values
 * rather than handlers, which is what makes the default comparison the right
 * one.
 */

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
export function ZoomControl({ zoom, onChange }: { zoom: Zoom; onChange: (next: Zoom) => void }) {
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

/**
 * The ruler, in two tiers.
 *
 * The lower tier is the old one: days, weeks or months. The upper is the
 * context it never carried — the month a "12" belongs to, the year a "Feb"
 * belongs to. Each band's label is sticky *within its own band*, so scrolling
 * halfway through March still says March instead of leaving the label off the
 * left edge with nothing to name the columns on screen.
 */
export const Ruler = memo(function Ruler({
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
  const chart = useChart();
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
});

export const Rules = memo(function Rules({ ticks, range, zoom }: { ticks: ReturnType<typeof ticksFor>; range: Range; zoom: Zoom }) {
  const chart = useChart();
  const viewport = useSyncExternalStore(
    chart.viewport.subscribe,
    chart.viewport.getSnapshot,
    chart.viewport.getSnapshot,
  );
  // At Day and Week zoom the grid is regular. One painted gradient replaces
  // thousands of absolutely positioned rules without changing the geometry
  // under the bars. Month and Quarter retain their calendar-aware tick nodes.
  const painted = zoom === "day" || zoom === "week";
  const visibleTicks = useMemo(() => {
    // Day zoom has a tick per day, and the canvas grows without giving days
    // back — filtering a list nothing is about to draw is the more expensive
    // half of the two.
    if (painted || !viewport) return ticks;
    // Keep the same generous buffer as the ruler so a quick drag does not
    // repeatedly mount calendar rules at the edge of the screen.
    const bufferDays = Math.max(30, Math.ceil(1800 / PX_PER_DAY[zoom]));
    const from = maxDate(range.start, addDays(viewport.from, -bufferDays));
    const to = minDate(range.end, addDays(viewport.to, bufferDays));
    return ticks.filter((tick) => tick.date >= from && tick.date <= to);
  }, [painted, range.end, range.start, ticks, viewport, zoom]);

  if (painted) {
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
      {visibleTicks.map((tick) => (
        <span
          key={tick.date}
          style={{ left: xCss(tick.date, range.start) }}
          className={clsx("absolute inset-y-0 w-px", tick.major ? "bg-separator" : "bg-separator/40")}
        />
      ))}
    </div>
  );
});

/**
 * Weekends.
 *
 * Only where a day is wide enough to be a column of its own: at Month and
 * Quarter a two-day stripe every 35 pixels is moiré, not information.
 */
export const Weekends = memo(function Weekends({ range, zoom }: { range: Range; zoom: Zoom }) {
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
});

export const TodayLine = memo(function TodayLine({ today, range }: { today: IsoDate; range: Range }) {
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
});

/**
 * Exams.
 *
 * A confirmed date is a hard rule with a flag. A provisional one is a hatched
 * *band* covering its whole window, because that is what it is: the app has been
 * told the exam falls somewhere in there, and drawing a line would state a day
 * nobody has. Planning still counts backwards from the start of the band.
 */
export const ExamMarkers = memo(function ExamMarkers({ courses, range }: { courses: readonly Course[]; range: Range }) {
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
});
