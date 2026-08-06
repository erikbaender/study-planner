/**
 * Timeline geometry: dates to pixels and back.
 *
 * Pure, because it is where the arithmetic bugs live — an off-by-one in the
 * day-to-x conversion is invisible until a bar sits one column left of the day
 * it claims, which is exactly the class of thing a screenshot does not catch.
 *
 * The whole canvas is `pxPerDay` wide per day, with no gaps. That is what makes
 * every derived number — a bar's left edge, the today line, an exam marker, the
 * date under the pointer mid-drag — the same expression rather than four
 * subtly different ones.
 */

import {
  addDays,
  differenceInDays,
  maxDate,
  minDate,
  startOfWeek,
  weekdayOf,
  type IsoDate,
} from "@/domain";
import type { Course } from "@/domain";

export const ZOOMS = ["day", "week", "month", "quarter"] as const;
export type Zoom = (typeof ZOOMS)[number];

export const ZOOM_LABELS: Record<Zoom, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

/**
 * How wide a day is at each zoom.
 *
 * These are chosen so the *visible span* roughly matches the zoom's name on a
 * 1000px canvas: a fortnight at Day, a couple of months at Week, half a year at
 * Month, two years at Quarter. The old implementation had a single scale and
 * produced a 15,000px canvas for one semester.
 */
export const PX_PER_DAY: Record<Zoom, number> = { day: 44, week: 14, month: 5, quarter: 1.8 };

/** What a drag snaps to. Below a certain width a single day is smaller than the pointer. */
export const SNAP_DAYS: Record<Zoom, number> = { day: 1, week: 1, month: 1, quarter: 7 };

export function xOf(date: IsoDate, start: IsoDate, zoom: Zoom): number {
  return differenceInDays(start, date) * PX_PER_DAY[zoom];
}

/* ─── The same arithmetic, in CSS ───────────────────────────────────────────
 *
 * Every position in the chart is `calc()`ed off one custom property holding the
 * width of a day, rather than baked into a pixel number by the functions above.
 * That is what makes a zoom change an animation: the property is registered as
 * a `<length>` in `globals.css` and therefore interpolates, so one transition
 * on the canvas moves the ruler, the grid, the exam markers and every bar
 * together — without React re-rendering a single lane per frame.
 *
 * The numeric versions stay, because hit-testing, extension and scroll targets
 * need a number now rather than a value the compositor is still animating.
 * ────────────────────────────────────────────────────────────────────────── */

export const DAY_WIDTH_PROPERTY = "--timeline-day-width";

/** A count of days as a CSS length that follows the animated day width. */
export function daysCss(days: number): string {
  return `calc(var(${DAY_WIDTH_PROPERTY}) * ${days})`;
}

export function xCss(date: IsoDate, start: IsoDate): string {
  return daysCss(differenceInDays(start, date));
}

/** Inclusive, like `widthOf`; `minimumPx` keeps a one-day bar from vanishing at Quarter. */
export function widthCss(start: IsoDate, end: IsoDate, minimumPx = 0): string {
  const span = daysCss(differenceInDays(start, end) + 1);
  return minimumPx > 0 ? `max(${span}, ${minimumPx}px)` : span;
}

/** Inclusive span: a block on one day is one day wide, not zero. */
export function widthOf(start: IsoDate, end: IsoDate, zoom: Zoom): number {
  return (differenceInDays(start, end) + 1) * PX_PER_DAY[zoom];
}

export function dateAt(x: number, start: IsoDate, zoom: Zoom): IsoDate {
  return addDays(start, Math.round(x / PX_PER_DAY[zoom]));
}

/** Days moved by a pointer displacement, snapped to the zoom's unit. */
export function daysMoved(deltaX: number, zoom: Zoom): number {
  const snap = SNAP_DAYS[zoom];
  return Math.round(deltaX / PX_PER_DAY[zoom] / snap) * snap;
}

/**
 * The window the canvas covers.
 *
 * Everything the plan knows about, plus padding at both ends — a bar flush
 * against the edge of a canvas looks clipped, and there has to be empty lane
 * after the last exam to drag a new block into.
 */
export function timelineRange(
  courses: readonly Course[],
  today: IsoDate,
): { start: IsoDate; end: IsoDate; days: number } {
  const dates: IsoDate[] = [today];
  for (const course of courses) {
    for (const exam of course.exams) {
      dates.push(exam.startDate);
      if (exam.endDate) dates.push(exam.endDate);
    }
    for (const topic of course.topics) {
      for (const block of topic.blocks) {
        dates.push(block.startDate, block.endDate);
      }
    }
  }

  // Weeks start on Monday, so the grid lines land where the labels do.
  const start = startOfWeek(addDays(minDate(...dates), -7));
  const end = addDays(maxDate(...dates), 14);
  return { start, end, days: differenceInDays(start, end) + 1 };
}

/** A date as a person reads it: "12 Feb". Used wherever a raw ISO string would be noise. */
export function shortDate(value: IsoDate): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export type Band = { key: string; label: string; start: IsoDate; end: IsoDate };

/**
 * The upper tier of the ruler.
 *
 * A single row of ticks answers "which day" and never "which month" — and the
 * labels that would answer it are exactly the ones a narrow zoom drops. "12 Feb"
 * with no year, or a lone narrow month letter at Quarter, is a date you cannot
 * place. So the header is two tiers: months over days and weeks, years over
 * months and quarters, each band spanning the width it actually covers.
 */
export function bandsFor(start: IsoDate, end: IsoDate, zoom: Zoom): Band[] {
  const bands: Band[] = [];
  const byMonth = zoom === "day" || zoom === "week";

  let cursor = byMonth ? `${start.slice(0, 7)}-01` : `${start.slice(0, 4)}-01-01`;
  while (cursor <= end) {
    const day = new Date(`${cursor}T00:00:00`);
    const next = new Date(day);
    if (byMonth) next.setMonth(next.getMonth() + 1);
    else next.setFullYear(next.getFullYear() + 1);
    const following = toIso(next);

    bands.push({
      key: cursor,
      label: byMonth
        ? day.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        : String(day.getFullYear()),
      // Clipped to the canvas, so the first and last bands do not claim width
      // the chart does not have and push their labels off the left edge.
      start: maxDate(cursor as IsoDate, start),
      end: minDate(addDays(following as IsoDate, -1), end),
    });
    cursor = following;
  }
  return bands;
}

/**
 * Saturdays and Sundays, for shading.
 *
 * Without them a semester is a featureless stripe and every estimate made
 * against it is wrong by two days a week: the eye reads a ten-day bar as ten
 * days of work when six is the honest number.
 */
export function weekendsIn(start: IsoDate, end: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let offset = 0; offset <= differenceInDays(start, end); offset += 1) {
    const date = addDays(start, offset);
    const weekday = weekdayOf(date);
    if (weekday === 0 || weekday === 6) days.push(date);
  }
  return days;
}

function toIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
}

export type Tick = { date: IsoDate; label: string; major: boolean };

/**
 * The ruler.
 *
 * One tick per day is right at Day zoom and 700 unreadable labels at Quarter,
 * so the interval scales with the zoom and the *major* ticks — the ones that
 * get a heavier rule — mark the next unit up. Months inside a Week zoom,
 * quarters inside a Month zoom: that is what stops a long canvas becoming a
 * featureless stripe.
 */
export function ticksFor(start: IsoDate, end: IsoDate, zoom: Zoom): Tick[] {
  const ticks: Tick[] = [];
  const total = differenceInDays(start, end);

  if (zoom === "day") {
    for (let offset = 0; offset <= total; offset += 1) {
      const date = addDays(start, offset);
      const day = new Date(`${date}T00:00:00`);
      ticks.push({
        date,
        label: String(day.getDate()),
        major: day.getDay() === 1,
      });
    }
    return ticks;
  }

  if (zoom === "week") {
    for (let offset = 0; offset <= total; offset += 7) {
      const date = addDays(start, offset);
      const day = new Date(`${date}T00:00:00`);
      ticks.push({
        date,
        label: day.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        major: day.getDate() <= 7,
      });
    }
    return ticks;
  }

  // Month and quarter both step by calendar month; only the labelling differs.
  let cursor = `${start.slice(0, 7)}-01`;
  while (cursor <= end) {
    const day = new Date(`${cursor}T00:00:00`);
    if (cursor >= start) {
      ticks.push({
        date: cursor,
        label:
          zoom === "month"
            ? day.toLocaleDateString(undefined, { month: "short" })
            : day.toLocaleDateString(undefined, { month: "narrow" }),
        major: day.getMonth() % 3 === 0,
      });
    }
    const next = new Date(day);
    next.setMonth(next.getMonth() + 1);
    // Serialised from the *local* fields, not `toISOString`: the cursor was
    // parsed at local midnight, and in any zone east of UTC that instant is
    // still the previous day in UTC — which put every month tick one day early.
    cursor = toIso(next);
  }
  return ticks;
}
