/**
 * The scheduling engine.
 *
 * Pure, deterministic, no clock and no React: `today` is an argument, and the
 * same inputs always produce the same blocks. That is what makes it testable,
 * and it is why the old code's hard-coded `const today = "2026-05-01"` was a
 * symptom rather than a typo.
 *
 * **Failure is an output, not an exception.** If the work does not fit before
 * the exam the engine still returns a plan — the best one available — alongside
 * an explicit shortfall. Throwing would leave the UI with nothing to show, and
 * silently returning an impossible plan would be worse than either: this
 * persona's whole problem is not knowing she is behind until it is too late.
 *
 * The algorithm is forward-filling under a backwards-derived priority, not a
 * true backwards pass. Topics are offered by deadline and priority as soon as
 * their dependencies have been offered; days are then filled from today
 * forward at capacity. For a single deadline the two are equivalent, and this
 * one degrades sensibly when several courses compete for the same days — which
 * is the case that actually occurs here, with ten courses and ten exams.
 */

import { addDays, eachDayInclusive, isStudyDay, studyDaysBetween, type StudyCalendar } from "./dates";
import { effectiveDeadline } from "./metrics";
import { DEFAULT_DAILY_CAPACITY_UNITS, type Course, type IsoDate, type Topic } from "./types";

/** What the caller gets back, before ids exist. */
export type PlannedBlock = {
  topicId: string;
  startDate: IsoDate;
  endDate: IsoDate;
  plannedUnits: number;
};

export type Shortfall = {
  courseId: string;
  courseName: string;
  deadline: IsoDate;
  /** Units that did not fit before the deadline. */
  unscheduledUnits: number;
  /** What the daily capacity would have to be. `Infinity` when there are no study days left. */
  requiredCapacity: number;
};

export type Schedule = {
  blocks: PlannedBlock[];
  shortfalls: Shortfall[];
  warnings: ScheduleWarning[];
};

export type ScheduleWarning = {
  type: "dependency" | "manual-after-deadline" | "manual-unavailable-day" | "manual-capacity" | "unsized-topic";
  courseId: string;
  topicId: string;
  message: string;
};

/** Used when the plan has no capacity recorded. Roughly two hours of slides. */
export const FALLBACK_CAPACITY_UNITS = DEFAULT_DAILY_CAPACITY_UNITS;

/**
 * How much of a topic still needs a place in the plan.
 *
 * Units covered by manual blocks on available days by the deadline are
 * excluded. Sessions after the deadline or on unavailable days cannot satisfy
 * preparation requirements.
 */
function remainingToSchedule(topic: Topic, deadline: IsoDate, calendar: StudyCalendar): number {
  if (topic.totalUnits <= 0) return 0;
  const outstanding = Math.max(0, topic.totalUnits - topic.completedUnits);
  const manual = topic.blocks.filter((block) => block.source === "manual").reduce((sum, block) => {
    const days = studyDaysBetween(block.startDate, block.endDate, calendar);
    if (days.length === 0) return sum;
    const beforeDeadline = days.filter((day) => day <= deadline).length;
    return sum + (block.plannedUnits ?? 0) * (beforeDeadline / days.length);
  }, 0);
  return Math.max(0, outstanding - manual);
}

const PRIORITY_RANK = { high: 0, normal: 1, low: 2 } as const;

/**
 * Plans the courses given, from `today` forward.
 *
 * Existing `manual` blocks are read (their days are already spoken for) and
 * never returned — the caller swaps only `auto` blocks, so a hand-placed block
 * cannot be moved or overwritten by a reflow.
 */
export function schedule(options: {
  courses: readonly Course[];
  today: IsoDate;
  calendar: StudyCalendar;
  dailyCapacityUnits?: number;
  /** How far ahead the engine is willing to plan when a course has no exam. */
  horizonDays?: number;
}): Schedule {
  const { courses, today, calendar, horizonDays = 180 } = options;
  const capacity = options.dailyCapacityUnits ?? FALLBACK_CAPACITY_UNITS;

  /** Units already committed per day, so several courses cannot claim the same hours. */
  const load = new Map<IsoDate, number>();
  const warnings: ScheduleWarning[] = [];
  const warningKeys = new Set<string>();
  const addWarning = (warning: ScheduleWarning) => {
    const key = `${warning.type}:${warning.topicId}:${warning.message}`;
    if (warningKeys.has(key)) return;
    warningKeys.add(key);
    warnings.push(warning);
  };
  const deadlines = new Map(courses.map((course) => [course.id, courseDeadline(course, today, horizonDays)]));

  for (const course of courses) {
    for (const topic of course.topics) {
      if (topic.totalUnits !== 0) continue;
      addWarning({
        type: "unsized-topic",
        courseId: course.id,
        topicId: topic.id,
        message: `${topic.name} has no size recorded and is excluded from schedule feasibility.`,
      });
    }
  }

  // Manual blocks are booked before anything is planned around them.
  for (const course of courses) {
    for (const topic of course.topics) {
      for (const block of topic.blocks) {
        if (block.source !== "manual") continue;
        const deadline = deadlines.get(course.id)!;
        if (block.endDate > deadline) {
          addWarning({
            type: "manual-after-deadline",
            courseId: course.id,
            topicId: topic.id,
            message: `${topic.name} has a manual block ending after its ${deadline} deadline.`,
          });
        }
        const days = eachDayInclusive(block.startDate, block.endDate);
        const spanDays = studyDaysBetween(block.startDate, block.endDate, calendar);
        if (days.some((day) => !isStudyDay(day, calendar))) {
          addWarning({
            type: "manual-unavailable-day",
            courseId: course.id,
            topicId: topic.id,
            message: `${topic.name} has a manual block on an unavailable study day.`,
          });
        }
        for (const day of days.filter((value) => isStudyDay(value, calendar))) {
          const unitsPerDay = block.plannedUnits && spanDays.length > 0
            ? block.plannedUnits / spanDays.length
            : capacity;
          if ((load.get(day) ?? 0) + unitsPerDay > capacity) {
            addWarning({
              type: "manual-capacity",
              courseId: course.id,
              topicId: topic.id,
              message: `${topic.name} conflicts with daily capacity on ${day}.`,
            });
          }
          load.set(day, (load.get(day) ?? 0) + unitsPerDay);
        }
      }
    }
  }

  const queue = orderTopics(courses, today, horizonDays);
  const blocks: PlannedBlock[] = [];
  const missed = new Map<string, number>();
  const finishDates = new Map<string, IsoDate>();
  const unresolvedTopics = new Set<string>();

  for (const entry of queue) {
    const dependencyIds = new Set(entry.topic.dependencyIds);
    const unresolved = [...dependencyIds].filter((id) => unresolvedTopics.has(id));
    if (unresolved.length > 0) {
      const pending = remainingToSchedule(entry.topic, entry.deadline, calendar);
      if (pending > 0) missed.set(entry.courseId, (missed.get(entry.courseId) ?? 0) + pending);
      unresolvedTopics.add(entry.topic.id);
      addWarning({
        type: "dependency",
        courseId: entry.courseId,
        topicId: entry.topic.id,
        message: `${entry.topic.name} cannot be scheduled because a prerequisite is not fully booked before its deadline.`,
      });
      continue;
    }

    let earliestStart = today;
    for (const dependencyId of dependencyIds) {
      const finish = finishDates.get(dependencyId);
      if (finish && addDays(finish, 1) > earliestStart) earliestStart = addDays(finish, 1);
    }

    const manualBeforeFinish = entry.topic.blocks.some(
      (block) => block.source === "manual" && [...dependencyIds].some((dependencyId) => {
        const finish = finishDates.get(dependencyId);
        return finish !== undefined && block.startDate <= finish;
      }),
    );
    if (manualBeforeFinish) {
      addWarning({
        type: "dependency",
        courseId: entry.courseId,
        topicId: entry.topic.id,
        message: `${entry.topic.name} has a manual block before its prerequisite is complete.`,
      });
    }

    if (earliestStart > entry.deadline) {
      const pending = remainingToSchedule(entry.topic, entry.deadline, calendar);
      if (pending > 0) {
        missed.set(entry.courseId, (missed.get(entry.courseId) ?? 0) + pending);
        unresolvedTopics.add(entry.topic.id);
        addWarning({
          type: "dependency",
          courseId: entry.courseId,
          topicId: entry.topic.id,
          message: `${entry.topic.name} cannot start before its ${entry.deadline} deadline because its prerequisite finishes on ${addDays(earliestStart, -1)}.`,
        });
      }
      continue;
    }

    let outstanding = remainingToSchedule(entry.topic, entry.deadline, calendar);
    if (entry.topic.totalUnits <= 0) {
      const manualEnd = entry.topic.blocks
        .filter((block) => block.source === "manual" && (block.plannedUnits ?? 0) > 0)
        .map((block) => block.endDate)
        .sort()
        .at(-1);
      if (entry.topic.status === "done" || manualEnd) {
        finishDates.set(entry.topic.id, manualEnd ?? addDays(today, -1));
      } else {
        unresolvedTopics.add(entry.topic.id);
        addWarning({
          type: "dependency",
          courseId: entry.courseId,
          topicId: entry.topic.id,
          message: `${entry.topic.name} has no size or booked finish date, so its prerequisites cannot be confirmed.`,
        });
      }
      continue;
    }
    if (outstanding === 0) {
      if (entry.topic.completedUnits >= entry.topic.totalUnits || entry.topic.status === "done") {
        finishDates.set(entry.topic.id, addDays(today, -1));
        continue;
      }
      const manualEnd = entry.topic.blocks
        .filter((block) => block.source === "manual" && (block.plannedUnits ?? 0) > 0)
        .map((block) => block.endDate)
        .sort()
        .at(-1);
      finishDates.set(entry.topic.id, manualEnd ?? addDays(today, -1));
      continue;
    }

    let cursor = earliestStart;
    let runStart: IsoDate | null = null;
    let runEnd: IsoDate | null = null;
    let runUnits = 0;

    const flush = () => {
      if (runStart && runEnd && runUnits > 0) {
        blocks.push({
          topicId: entry.topic.id,
          startDate: runStart,
          endDate: runEnd,
          plannedUnits: runUnits,
        });
      }
      runStart = null;
      runEnd = null;
      runUnits = 0;
    };

    while (outstanding > 0 && cursor <= entry.deadline) {
      if (isStudyDay(cursor, calendar)) {
        const used = load.get(cursor) ?? 0;
        const free = capacity - used;
        if (free > 0) {
          const take = Math.min(free, outstanding);
          load.set(cursor, used + take);
          outstanding -= take;
          // Consecutive filled days become one block. A block per day would
          // give a 500-slide topic forty bars on the timeline, which reads as
          // forty tasks rather than one.
          if (runStart === null) runStart = cursor;
          runEnd = cursor;
          runUnits += take;
        } else {
          flush();
        }
      }
      cursor = addDays(cursor, 1);
    }

    flush();

    const finalEnd = blocks.filter((block) => block.topicId === entry.topic.id)
      .map((block) => block.endDate).sort().at(-1);
    const manualEnd = entry.topic.blocks
      .filter((block) => block.source === "manual" && (block.plannedUnits ?? 0) > 0 && block.startDate <= entry.deadline)
      .map((block) => block.endDate).sort().at(-1);
    const finishDate = [finalEnd, manualEnd].filter((value): value is IsoDate => Boolean(value)).sort().at(-1);

    if (outstanding > 0) {
      missed.set(entry.courseId, (missed.get(entry.courseId) ?? 0) + outstanding);
      unresolvedTopics.add(entry.topic.id);
    } else if (finishDate) {
      finishDates.set(entry.topic.id, finishDate);
    }
  }

  return {
    blocks,
    shortfalls: shortfallsFor(courses, today, calendar, capacity, horizonDays, missed),
    warnings,
  };
}

function courseDeadline(course: Course, today: IsoDate, horizonDays: number): IsoDate {
  const exam = course.exams
    .filter((candidate) => effectiveDeadline(candidate) >= today)
    .sort((left, right) => (effectiveDeadline(left) < effectiveDeadline(right) ? -1 : 1))[0];
  return exam ? effectiveDeadline(exam) : addDays(today, horizonDays);
}

/**
 * The order work is offered days in.
 *
 * Nearest deadline first, because a day given to a course whose exam is in two
 * months is a day taken from one whose exam is next week. Within a course,
 * dependencies come before priority — a high-priority topic that cannot be
 * started yet is not more urgent, it is blocked.
 */
function orderTopics(
  courses: readonly Course[],
  today: IsoDate,
  horizonDays: number,
): Array<{ topic: Topic; courseId: string; deadline: IsoDate }> {
  let stableOrder = 0;
  const entries = courses.flatMap((course) => {
    const exam = course.exams
      .filter((candidate) => effectiveDeadline(candidate) >= today)
      .sort((left, right) => (effectiveDeadline(left) < effectiveDeadline(right) ? -1 : 1))[0];
    const deadline = exam ? effectiveDeadline(exam) : addDays(today, horizonDays);

    return [...course.topics].sort((left, right) => left.order - right.order).map((topic) => ({
      topic,
      courseId: course.id,
      deadline,
      stableOrder: stableOrder++,
    }));
  });

  const compare = (left: (typeof entries)[number], right: (typeof entries)[number]) =>
    (left.deadline < right.deadline ? -1 : left.deadline > right.deadline ? 1 : 0) ||
    PRIORITY_RANK[left.topic.priority] - PRIORITY_RANK[right.topic.priority] ||
    left.stableOrder - right.stableOrder;

  const topicsByCourse = new Map<string, Map<string, (typeof entries)[number]>>();
  for (const entry of entries) {
    const topics = topicsByCourse.get(entry.courseId) ?? new Map();
    topics.set(entry.topic.id, entry);
    topicsByCourse.set(entry.courseId, topics);
  }

  const dependencyCount = new Map(entries.map((entry) => [entry, 0]));
  const dependents = new Map<(typeof entries)[number], (typeof entries)[number][]>();

  for (const entry of entries) {
    const courseTopics = topicsByCourse.get(entry.courseId)!;
    for (const dependencyId of new Set(entry.topic.dependencyIds)) {
      const dependency = courseTopics.get(dependencyId);
      if (!dependency) continue;
      dependencyCount.set(entry, dependencyCount.get(entry)! + 1);
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), entry]);
    }
  }

  const ready = entries.filter((entry) => dependencyCount.get(entry) === 0);
  const ordered: typeof entries = [];

  // This is Kahn's topological sort with the product priorities as its ready
  // queue. Priority can choose between work that is currently available, but
  // it can never move a dependent ahead of the work that unlocks it.
  while (ready.length > 0) {
    ready.sort(compare);
    const entry = ready.shift()!;
    ordered.push(entry);

    for (const dependent of dependents.get(entry) ?? []) {
      const remaining = dependencyCount.get(dependent)! - 1;
      dependencyCount.set(dependent, remaining);
      if (remaining === 0) ready.push(dependent);
    }
  }

  // Validation prevents cycles, but malformed imported data must not make the
  // scheduler silently drop topics. There is no valid dependency order for a
  // cycle, so retain every unresolved topic in deterministic product order.
  const emitted = new Set(ordered);
  ordered.push(...entries.filter((entry) => !emitted.has(entry)).sort(compare));

  return ordered.map(({ topic, courseId, deadline }) => ({ topic, courseId, deadline }));
}

function shortfallsFor(
  courses: readonly Course[],
  today: IsoDate,
  calendar: StudyCalendar,
  capacity: number,
  horizonDays: number,
  missed: Map<string, number>,
): Shortfall[] {
  const shortfalls: Shortfall[] = [];

  for (const course of courses) {
    const unscheduledUnits = missed.get(course.id);
    if (!unscheduledUnits) continue;

    const exam = course.exams
      .filter((candidate) => effectiveDeadline(candidate) >= today)
      .sort((left, right) => (effectiveDeadline(left) < effectiveDeadline(right) ? -1 : 1))[0];
    const deadline = exam ? effectiveDeadline(exam) : addDays(today, horizonDays);

    let studyDays = 0;
    for (let cursor = today; cursor <= deadline; cursor = addDays(cursor, 1)) {
      if (isStudyDay(cursor, calendar)) studyDays += 1;
    }

    const total = course.topics.reduce(
      (sum, topic) => sum + remainingToSchedule(topic, deadline, calendar),
      0,
    );

    shortfalls.push({
      courseId: course.id,
      courseName: course.name,
      deadline,
      unscheduledUnits: Math.ceil(unscheduledUnits),
      // What capacity *would* have worked, which is the number worth quoting:
      // "you need 62 a day and your capacity is 40" is actionable in a way that
      // "you are behind" is not.
      requiredCapacity: studyDays > 0 ? Math.ceil(total / studyDays) : Infinity,
    });
  }

  return shortfalls;
}

/**
 * Reads a shortfall out loud, in the shape §6 asks for.
 *
 * Three different sentences, because there are three different problems, and
 * the wrong one is a lie. `requiredCapacity` is what the course would need *on
 * its own*; when that is within capacity the course is perfectly feasible and
 * what it actually lost was days, to courses with nearer exams. Saying "needs 5
 * a day, your capacity is 40, you are 124 over" — which is what the single
 * sentence produced — is a contradiction the reader has to unpick.
 */
export function describeShortfall(shortfall: Shortfall, capacity: number): string {
  if (!Number.isFinite(shortfall.requiredCapacity)) {
    return `${shortfall.courseName} has no study days left before ${shortfall.deadline}, and ${shortfall.unscheduledUnits} units are still unplanned.`;
  }

  if (shortfall.requiredCapacity <= capacity) {
    return `${shortfall.courseName} would fit on its own at ${shortfall.requiredCapacity} units a day, but ${shortfall.unscheduledUnits} units could not be booked before the deadline.`;
  }

  return `${shortfall.courseName} needs ${shortfall.requiredCapacity} units a day to finish in time; your capacity is ${capacity}. You are ${shortfall.unscheduledUnits} units over.`;
}
