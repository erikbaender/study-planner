/**
 * Derived numbers: progress, pace, velocity, and whether a course is on track.
 *
 * All pure, all take `today` as an argument. These are the figures the Today
 * view and the sidebar are built from, and the reason the domain model needed
 * topic sizes at all — none of this is computable from dates alone.
 */

import {
  addDays,
  compareDates,
  countStudyDays,
  differenceInDays,
  isStudyDay,
  type StudyCalendar,
} from "./dates";
import type { Course, Exam, IsoDate, StudyLogEntry, Topic } from "./types";

/** Trailing window for velocity. Long enough to smooth a bad day, short enough to react within a week. */
export const VELOCITY_WINDOW_DAYS = 7;
/** Smart-view horizon shared by its sidebar count and destination list. */
export const UPCOMING_WINDOW_DAYS = 30;

export type Progress = {
  totalUnits: number;
  completedUnits: number;
  remainingUnits: number;
  /** `0`–`1`, or `null` when nothing in scope has a tracked size. */
  ratio: number | null;
};

/** Topics with `totalUnits === 0` are size-untracked and excluded entirely. */
export function progressOf(topics: readonly Topic[]): Progress {
  const sized = topics.filter((topic) => topic.totalUnits > 0);
  const totalUnits = sized.reduce((sum, topic) => sum + topic.totalUnits, 0);
  const completedUnits = sized.reduce(
    (sum, topic) => sum + Math.min(topic.completedUnits, topic.totalUnits),
    0,
  );

  return {
    totalUnits,
    completedUnits,
    remainingUnits: totalUnits - completedUnits,
    ratio: totalUnits > 0 ? completedUnits / totalUnits : null,
  };
}

export function courseProgress(course: Course): Progress {
  return progressOf(course.topics);
}

export function topicProgress(topic: Topic): Progress {
  return progressOf([topic]);
}

/**
 * The date a course must be ready by: its earliest exam.
 *
 * For a provisional window this is the *start* — planning for the far end of an
 * announced window is how you end up unprepared on the day it actually lands.
 */
export function effectiveDeadline(exam: Exam): IsoDate {
  return exam.startDate;
}

export function nextExam(course: Course, today: IsoDate): Exam | null {
  const upcoming = course.exams
    .filter((exam) => effectiveDeadline(exam) >= today)
    .sort((left, right) => compareDates(effectiveDeadline(left), effectiveDeadline(right)));
  return upcoming[0] ?? null;
}

export function daysUntil(date: IsoDate, today: IsoDate): number {
  return differenceInDays(today, date);
}

/**
 * Mean units per day over the trailing window, counting only *study* days.
 *
 * Dividing by elapsed calendar days would punish someone for taking their
 * scheduled day off, which would make the on-track indicator lie.
 */
export function velocity(
  log: readonly StudyLogEntry[],
  today: IsoDate,
  calendar: StudyCalendar,
  windowDays: number = VELOCITY_WINDOW_DAYS,
): number {
  const windowStart = addDays(today, -(windowDays - 1));
  const unitsInWindow = log
    .filter((entry) => entry.date >= windowStart && entry.date <= today)
    .reduce((sum, entry) => sum + entry.units, 0);

  const availableDays = countStudyDays(windowStart, today, calendar);
  if (availableDays === 0) return 0;
  return unitsInWindow / availableDays;
}

export function velocityForTopics(
  log: readonly StudyLogEntry[],
  topicIds: ReadonlySet<string>,
  today: IsoDate,
  calendar: StudyCalendar,
  windowDays: number = VELOCITY_WINDOW_DAYS,
): number {
  return velocity(
    log.filter((entry) => topicIds.has(entry.topicId)),
    today,
    calendar,
    windowDays,
  );
}

export type PaceAssessment = {
  remainingUnits: number;
  /** Available study days in `[today, deadline]`, inclusive. */
  studyDaysLeft: number;
  /** Units per study day needed from now on. `Infinity` when work remains but no days do. */
  requiredPace: number;
  /** Observed units per study day over the trailing window. */
  actualVelocity: number;
  /** `null` when velocity is zero — an unknowable finish date, not a distant one. */
  projectedFinish: IsoDate | null;
  onTrack: boolean;
  /** How far past the deadline the projection lands. `0` when on time or unknowable. */
  daysLate: number;
};

/**
 * Can this course be finished by its deadline at the current rate?
 *
 * `projectedFinish` walks forward day by day rather than dividing, because
 * weekends and blackout dates make the answer non-linear — 100 units at 20/day
 * is five *study* days, which may be nine calendar days.
 */
export function assessPace(options: {
  remainingUnits: number;
  today: IsoDate;
  deadline: IsoDate;
  calendar: StudyCalendar;
  actualVelocity: number;
  dailyCapacityUnits?: number;
}): PaceAssessment {
  const { remainingUnits, today, deadline, calendar, actualVelocity } = options;

  const studyDaysLeft = deadline >= today ? countStudyDays(today, deadline, calendar) : 0;
  const requiredPace =
    remainingUnits === 0 ? 0 : studyDaysLeft === 0 ? Infinity : remainingUnits / studyDaysLeft;

  const projectedFinish = projectFinishDate({
    remainingUnits,
    today,
    calendar,
    unitsPerDay: actualVelocity,
  });

  const daysLate =
    projectedFinish && projectedFinish > deadline ? differenceInDays(deadline, projectedFinish) : 0;

  const capacity = options.dailyCapacityUnits;
  const sustainablePace = capacity ? Math.min(capacity, Math.max(actualVelocity, 0)) : actualVelocity;

  return {
    remainingUnits,
    studyDaysLeft,
    requiredPace,
    actualVelocity,
    projectedFinish,
    // Nothing left to do is trivially on track, whatever the velocity.
    onTrack: remainingUnits === 0 || (Number.isFinite(requiredPace) && requiredPace <= sustainablePace),
    daysLate,
  };
}

/** `null` when there is no forward progress to extrapolate from. */
export function projectFinishDate(options: {
  remainingUnits: number;
  today: IsoDate;
  calendar: StudyCalendar;
  unitsPerDay: number;
  /** Guards against an unbounded walk on a pathologically slow velocity. */
  maxDays?: number;
}): IsoDate | null {
  const { remainingUnits, today, calendar, unitsPerDay, maxDays = 3650 } = options;
  if (remainingUnits <= 0) return today;
  if (unitsPerDay <= 0) return null;

  let outstanding = remainingUnits;
  let cursor = today;

  for (let elapsed = 0; elapsed < maxDays; elapsed += 1) {
    if (isStudyDay(cursor, calendar)) {
      outstanding -= unitsPerDay;
      if (outstanding <= 0) return cursor;
    }
    cursor = addDays(cursor, 1);
  }

  return null;
}

export type CourseHealth = {
  courseId: string;
  progress: Progress;
  exam: Exam | null;
  daysUntilExam: number | null;
  pace: PaceAssessment | null;
};

/**
 * The sidebar/Today summary for one course.
 *
 * `pace` is `null` when there is no upcoming exam — without a deadline, "behind"
 * has no meaning, and inventing one would produce alarming numbers for a course
 * that is simply not scheduled yet.
 */
export function assessCourse(options: {
  course: Course;
  today: IsoDate;
  calendar: StudyCalendar;
  log: readonly StudyLogEntry[];
  dailyCapacityUnits?: number;
}): CourseHealth {
  const { course, today, calendar, log, dailyCapacityUnits } = options;
  const progress = courseProgress(course);
  const exam = nextExam(course, today);
  const topicIds = new Set(course.topics.map((topic) => topic.id));

  return {
    courseId: course.id,
    progress,
    exam,
    daysUntilExam: exam ? daysUntil(effectiveDeadline(exam), today) : null,
    pace: exam
      ? assessPace({
          remainingUnits: progress.remainingUnits,
          today,
          deadline: effectiveDeadline(exam),
          calendar,
          actualVelocity: velocityForTopics(log, topicIds, today, calendar),
          dailyCapacityUnits,
        })
      : null,
  };
}
