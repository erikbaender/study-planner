import {
  addDays,
  differenceInDays,
  maxDate,
  minDate,
  parseIsoDate,
  type IsoDate,
  type Plan,
} from "@/domain";

export const TIMELINE_ZOOMS = ["day", "week", "month", "quarter"] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

export const ZOOM_CONFIG: Record<
  TimelineZoom,
  { pixelsPerDay: number; snapDays: number }
> = {
  day: { pixelsPerDay: 28, snapDays: 1 },
  week: { pixelsPerDay: 10, snapDays: 7 },
  month: { pixelsPerDay: 3.5, snapDays: 30 },
  quarter: { pixelsPerDay: 1.5, snapDays: 91 },
};

export type TimelineRange = {
  start: IsoDate;
  end: IsoDate;
  dayCount: number;
};

export function timelineRange(plan: Plan, today: IsoDate): TimelineRange {
  const dates = [
    today,
    ...(plan.startDate ? [plan.startDate] : []),
    ...(plan.endDate ? [plan.endDate] : []),
    ...plan.courses.flatMap((course) => [
      ...course.exams.flatMap((exam) => [
        exam.startDate,
        ...(exam.endDate ? [exam.endDate] : []),
      ]),
      ...course.topics.flatMap((topic) =>
        topic.blocks.flatMap((block) => [block.startDate, block.endDate]),
      ),
    ]),
  ];
  const start = addDays(minDate(...dates), -7);
  const end = addDays(maxDate(...dates), 7);
  return { start, end, dayCount: differenceInDays(start, end) + 1 };
}

export function dayOffset(rangeStart: IsoDate, date: IsoDate): number {
  return differenceInDays(rangeStart, date);
}

export function snapDragDelta(
  pixelDelta: number,
  zoom: TimelineZoom,
): number {
  const { pixelsPerDay, snapDays } = ZOOM_CONFIG[zoom];
  return Math.round(pixelDelta / pixelsPerDay / snapDays) * snapDays;
}

export function moveDateRange(
  startDate: IsoDate,
  endDate: IsoDate,
  deltaDays: number,
): { startDate: IsoDate; endDate: IsoDate } {
  return {
    startDate: addDays(startDate, deltaDays),
    endDate: addDays(endDate, deltaDays),
  };
}

export function isTimelineTick(date: IsoDate, zoom: TimelineZoom): boolean {
  const parsed = parseIsoDate(date);
  if (zoom === "day") return true;
  if (zoom === "week") return parsed.getUTCDay() === 1;
  if (zoom === "month") return parsed.getUTCDate() === 1;
  return parsed.getUTCDate() === 1 && parsed.getUTCMonth() % 3 === 0;
}

export function formatTimelineTick(date: IsoDate, zoom: TimelineZoom): string {
  const parsed = parseIsoDate(date);
  if (zoom === "day") {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "narrow",
      day: "numeric",
      timeZone: "UTC",
    }).format(parsed);
  }
  if (zoom === "week") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(parsed);
  }
  if (zoom === "month") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    }).format(parsed);
  }
  return `Q${Math.floor(parsed.getUTCMonth() / 3) + 1} ${String(
    parsed.getUTCFullYear(),
  ).slice(-2)}`;
}
