/**
 * Date arithmetic for `YYYY-MM-DD` strings.
 *
 * Everything here works in UTC. `new Date("2026-05-01")` parses as UTC
 * midnight, but `getDay()`/`getDate()` read it back in the *local* zone, so
 * west of Greenwich they report the previous day. Every accessor below is the
 * `getUTC*` form, and every constructor goes through `Date.UTC`. Mixing the two
 * families is the single most common source of off-by-one date bugs.
 *
 * No function here reads the clock. Callers pass "today" in explicitly, which
 * is what makes the scheduler testable — the previous implementation hard-coded
 * `const today = "2026-05-01"` and silently rotted.
 */

import type { IsoDate, Weekday } from "./types";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** True for a well-formed date string that names a real calendar day. */
export function isValidIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return false;
  // Rejects overflow like "2026-02-31", which Date silently rolls forward.
  return toIsoDate(date) === value;
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(parseIsoDate(value).getTime() + days * MS_PER_DAY));
}

/** Calendar days from `from` to `to`; negative when `to` precedes `from`. */
export function differenceInDays(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / MS_PER_DAY);
}

/** Sort comparator; ISO dates also compare correctly as plain strings. */
export function compareDates(left: IsoDate, right: IsoDate): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function minDate(...dates: IsoDate[]): IsoDate {
  return dates.reduce((lowest, date) => (date < lowest ? date : lowest));
}

export function maxDate(...dates: IsoDate[]): IsoDate {
  return dates.reduce((highest, date) => (date > highest ? date : highest));
}

export function clampDate(value: IsoDate, lower: IsoDate, upper: IsoDate): IsoDate {
  return value < lower ? lower : value > upper ? upper : value;
}

export function weekdayOf(value: IsoDate): Weekday {
  return parseIsoDate(value).getUTCDay() as Weekday;
}

/** Inclusive on both ends. Returns `[]` if `end` precedes `start`. */
export function eachDayInclusive(start: IsoDate, end: IsoDate): IsoDate[] {
  const span = differenceInDays(start, end);
  if (span < 0) return [];
  return Array.from({ length: span + 1 }, (_unused, offset) => addDays(start, offset));
}

/** Inclusive day count for a range, so a single-day range spans 1. */
export function rangeLengthInDays(start: IsoDate, end: IsoDate): number {
  return Math.max(0, differenceInDays(start, end) + 1);
}

/** Inclusive overlap test, matching how ranges are drawn on the timeline. */
export function rangesOverlap(
  aStart: IsoDate,
  aEnd: IsoDate,
  bStart: IsoDate,
  bEnd: IsoDate,
): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export type StudyCalendar = {
  studyDaysOfWeek: readonly Weekday[];
  blackoutDates: readonly IsoDate[];
};

/** A day is available when its weekday is a study day and it is not blacked out. */
export function isStudyDay(value: IsoDate, calendar: StudyCalendar): boolean {
  if (!calendar.studyDaysOfWeek.includes(weekdayOf(value))) return false;
  return !calendar.blackoutDates.includes(value);
}

/** Every available day in `[start, end]`, in ascending order. */
export function studyDaysBetween(
  start: IsoDate,
  end: IsoDate,
  calendar: StudyCalendar,
): IsoDate[] {
  return eachDayInclusive(start, end).filter((day) => isStudyDay(day, calendar));
}

export function countStudyDays(start: IsoDate, end: IsoDate, calendar: StudyCalendar): number {
  return studyDaysBetween(start, end, calendar).length;
}

/** Monday-based, matching the week grid the timeline draws. */
export function startOfWeek(value: IsoDate): IsoDate {
  const weekday = weekdayOf(value);
  return addDays(value, weekday === 0 ? -6 : 1 - weekday);
}

export function startOfMonth(value: IsoDate): IsoDate {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: IsoDate): IsoDate {
  return addDays(addMonths(startOfMonth(value), 1), -1);
}

/**
 * Clamps to the last day of the target month, so 31 January plus one month is
 * 28 February rather than rolling into March.
 */
export function addMonths(value: IsoDate, months: number): IsoDate {
  const date = parseIsoDate(value);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toIsoDate(new Date(Date.UTC(year, month, Math.min(day, lastDayOfTarget))));
}
