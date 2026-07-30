/**
 * Pure schedule generation.
 *
 * The engine knows nothing about repositories or React. It receives an
 * injected date and calendar, emits only generated blocks, and reports work
 * that does not fit instead of pretending an impossible plan is complete.
 */

import { addDays, studyDaysBetween } from "./dates";
import { effectiveDeadline, nextExam } from "./metrics";
import type {
  Course,
  EntityId,
  IsoDate,
  Preferences,
  Priority,
  StudyBlock,
  Topic,
} from "./types";

export type ScheduledBlock = {
  topicId: EntityId;
  startDate: IsoDate;
  endDate: IsoDate;
  plannedUnits: number;
};

export type CourseSchedule = {
  courseId: EntityId;
  deadline: IsoDate | null;
  studyDays: number;
  remainingUnits: number;
  manualUnits: number;
  scheduledUnits: number;
  shortfallUnits: number;
  requiredDailyUnits: number | null;
  status: "scheduled" | "infeasible" | "no-deadline" | "nothing-to-schedule";
};

export type ScheduleResult = {
  blocks: ScheduledBlock[];
  courses: CourseSchedule[];
  capacityUnits: number | null;
  feasible: boolean;
  shortfallUnits: number;
  unsizedTopicCount: number;
  unmeasuredManualBlockCount: number;
};

export type ScheduleOptions = {
  courses: readonly Course[];
  today: IsoDate;
  preferences: Pick<
    Preferences,
    "dailyCapacityUnits" | "studyDaysOfWeek" | "blackoutDates"
  >;
  /** Used by the What-if control without mutating saved preferences. */
  dailyCapacityUnits?: number;
};

type CourseWork = {
  course: Course;
  deadline: IsoDate;
  lastStudyDate: IsoDate;
  days: IsoDate[];
  remainingByTopic: Map<EntityId, number>;
  manualByTopic: Map<EntityId, number>;
  unsizedTopicCount: number;
  unmeasuredManualBlockCount: number;
};

const PRIORITY_RANK: Record<Priority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

/**
 * Builds one schedule across the supplied courses so they share the same daily
 * capacity. Exam day itself is not used: the material must be ready before the
 * exam begins.
 */
export function scheduleCourses(options: ScheduleOptions): ScheduleResult {
  const capacity = options.dailyCapacityUnits ?? options.preferences.dailyCapacityUnits;
  const capacityUnits =
    typeof capacity === "number" && Number.isFinite(capacity) && capacity > 0 ? capacity : null;
  const calendar = {
    studyDaysOfWeek: options.preferences.studyDaysOfWeek,
    blackoutDates: options.preferences.blackoutDates,
  };

  const work: CourseWork[] = [];
  const courseResults = new Map<EntityId, CourseSchedule>();
  let unsizedTopicCount = 0;
  let unmeasuredManualBlockCount = 0;

  for (const course of options.courses) {
    const exam = nextExam(course, options.today);
    const remainingUnits = course.topics.reduce(
      (sum, topic) => sum + trackedRemaining(topic),
      0,
    );
    const courseUnsized = course.topics.filter(
      (topic) => topic.totalUnits === 0 && topic.status !== "done",
    ).length;
    unsizedTopicCount += courseUnsized;

    if (!exam) {
      courseResults.set(course.id, {
        courseId: course.id,
        deadline: null,
        studyDays: 0,
        remainingUnits,
        manualUnits: 0,
        scheduledUnits: 0,
        shortfallUnits: 0,
        requiredDailyUnits: null,
        status: remainingUnits > 0 ? "no-deadline" : "nothing-to-schedule",
      });
      continue;
    }

    const deadline = effectiveDeadline(exam);
    const lastStudyDate = addDays(deadline, -1);
    const days = studyDaysBetween(options.today, lastStudyDate, calendar);
    const remainingByTopic = new Map<EntityId, number>();
    const manualByTopic = new Map<EntityId, number>();
    let courseManualUnits = 0;
    let courseUnmeasuredManualBlocks = 0;

    for (const topic of course.topics) {
      const remaining = trackedRemaining(topic);
      if (remaining <= 0) continue;
      remainingByTopic.set(topic.id, remaining);

      const manualUnits = topic.blocks.reduce((sum, block) => {
        if (
          block.source !== "manual" ||
          block.endDate < options.today ||
          block.startDate > lastStudyDate
        ) {
          return sum;
        }
        if (block.plannedUnits === undefined) {
          courseUnmeasuredManualBlocks += 1;
          return sum;
        }
        return sum + Math.max(0, block.plannedUnits);
      }, 0);
      const credited = Math.min(remaining, manualUnits);
      manualByTopic.set(topic.id, credited);
      courseManualUnits += credited;
    }

    unmeasuredManualBlockCount += courseUnmeasuredManualBlocks;
    work.push({
      course,
      deadline,
      lastStudyDate,
      days,
      remainingByTopic,
      manualByTopic,
      unsizedTopicCount: courseUnsized,
      unmeasuredManualBlockCount: courseUnmeasuredManualBlocks,
    });
    courseResults.set(course.id, {
      courseId: course.id,
      deadline,
      studyDays: days.length,
      remainingUnits,
      manualUnits: courseManualUnits,
      scheduledUnits: 0,
      shortfallUnits: 0,
      requiredDailyUnits:
        remainingUnits === 0 ? 0 : days.length ? remainingUnits / days.length : Infinity,
      status: remainingUnits > 0 ? "scheduled" : "nothing-to-schedule",
    });
  }

  if (capacityUnits === null) {
    for (const item of work) {
      const result = courseResults.get(item.course.id);
      if (!result || result.remainingUnits === 0) continue;
      result.shortfallUnits = Math.max(0, result.remainingUnits - result.manualUnits);
      result.status = "infeasible";
    }
    return finish(
      options.courses,
      courseResults,
      [],
      capacityUnits,
      unsizedTopicCount,
      unmeasuredManualBlockCount,
    );
  }

  const remainingCapacity = new Map<IsoDate, number>();
  for (const item of work) {
    for (const day of item.days) {
      if (!remainingCapacity.has(day)) remainingCapacity.set(day, capacityUnits);
    }
  }

  // Manual placements reserve their stated share before generated work gets a
  // chance to use the day. Blocks without a target remain protected, but their
  // unknown cost cannot honestly be subtracted from capacity.
  for (const item of work) {
    for (const topic of item.course.topics) {
      for (const block of topic.blocks) {
        reserveManualBlock(block, item, calendar, remainingCapacity);
      }
    }
  }

  const blocks: ScheduledBlock[] = [];
  // Earlier exams claim shared capacity first. The original course order is a
  // stable tie-breaker, making repeated runs byte-identical.
  work.sort(
    (left, right) =>
      left.deadline.localeCompare(right.deadline) ||
      left.course.order - right.course.order ||
      left.course.id.localeCompare(right.course.id),
  );

  for (const item of work) {
    const result = courseResults.get(item.course.id);
    if (!result || result.remainingUnits === 0) continue;

    const assignedDays = new Map<EntityId, IsoDate[]>(
      item.course.topics.map((topic) => [
        topic.id,
        topic.blocks
          .filter(
            (block) =>
              block.source === "manual" &&
              block.endDate >= options.today &&
              block.startDate <= item.lastStudyDate,
          )
          .map((block) => (block.startDate < options.today ? options.today : block.startDate)),
      ]),
    );
    let scheduledUnits = 0;
    let shortfallUnits = 0;

    for (const topic of backwardTopicOrder(item.course.topics)) {
      const remaining = item.remainingByTopic.get(topic.id) ?? 0;
      let outstanding = Math.max(0, remaining - (item.manualByTopic.get(topic.id) ?? 0));
      if (outstanding === 0) continue;

      const dependentDates = dependantsOf(topic.id, item.course.topics)
        .flatMap((id) => assignedDays.get(id) ?? [])
        .sort();
      const latestAllowed = dependentDates[0] ? addDays(dependentDates[0], -1) : item.lastStudyDate;
      const topicDays = [...(assignedDays.get(topic.id) ?? [])];

      for (const day of [...item.days].reverse()) {
        if (day > latestAllowed || outstanding <= 0) continue;
        const available = remainingCapacity.get(day) ?? 0;
        if (available <= 0) continue;

        const plannedUnits = roundUnits(Math.min(available, outstanding));
        if (plannedUnits <= 0) continue;
        blocks.push({
          topicId: topic.id,
          startDate: day,
          endDate: day,
          plannedUnits,
        });
        topicDays.push(day);
        outstanding = roundUnits(outstanding - plannedUnits);
        remainingCapacity.set(day, roundUnits(available - plannedUnits));
        scheduledUnits += plannedUnits;
      }

      assignedDays.set(topic.id, topicDays);
      shortfallUnits += Math.max(0, outstanding);
    }

    result.scheduledUnits = roundUnits(scheduledUnits);
    result.shortfallUnits = roundUnits(shortfallUnits);
    result.status = shortfallUnits > 0 ? "infeasible" : "scheduled";
  }

  blocks.sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.topicId.localeCompare(right.topicId),
  );

  return finish(
    options.courses,
    courseResults,
    blocks,
    capacityUnits,
    unsizedTopicCount,
    unmeasuredManualBlockCount,
  );
}

function finish(
  courses: readonly Course[],
  results: ReadonlyMap<EntityId, CourseSchedule>,
  blocks: ScheduledBlock[],
  capacityUnits: number | null,
  unsizedTopicCount: number,
  unmeasuredManualBlockCount: number,
): ScheduleResult {
  const courseSchedules = courses.map((course) => {
    const result = results.get(course.id);
    if (!result) throw new Error(`Missing schedule result for ${course.id}`);
    return result;
  });
  const shortfallUnits = roundUnits(
    courseSchedules.reduce((sum, course) => sum + course.shortfallUnits, 0),
  );

  return {
    blocks,
    courses: courseSchedules,
    capacityUnits,
    feasible: capacityUnits !== null && shortfallUnits === 0,
    shortfallUnits,
    unsizedTopicCount,
    unmeasuredManualBlockCount,
  };
}

function trackedRemaining(topic: Topic): number {
  if (topic.totalUnits <= 0) return 0;
  return Math.max(0, topic.totalUnits - Math.min(topic.completedUnits, topic.totalUnits));
}

function reserveManualBlock(
  block: StudyBlock,
  item: CourseWork,
  calendar: Pick<Preferences, "studyDaysOfWeek" | "blackoutDates">,
  remainingCapacity: Map<IsoDate, number>,
) {
  if (
    block.source !== "manual" ||
    block.plannedUnits === undefined ||
    block.plannedUnits <= 0 ||
    block.endDate < item.days[0] ||
    block.startDate > item.lastStudyDate
  ) {
    return;
  }

  const start = block.startDate < item.days[0] ? item.days[0] : block.startDate;
  const end = block.endDate > item.lastStudyDate ? item.lastStudyDate : block.endDate;
  const days = studyDaysBetween(start, end, calendar);
  if (!days.length) return;

  const share = block.plannedUnits / days.length;
  for (const day of days) {
    const available = remainingCapacity.get(day);
    if (available === undefined) continue;
    remainingCapacity.set(day, roundUnits(Math.max(0, available - share)));
  }
}

/**
 * Allocation runs backwards, so dependants are placed before prerequisites.
 * Once a dependant has dates, its prerequisites are capped to the preceding
 * day. Priority decides between otherwise-independent topics.
 */
function backwardTopicOrder(topics: readonly Topic[]): Topic[] {
  const ids = new Set(topics.map((topic) => topic.id));
  const dependants = new Map<EntityId, EntityId[]>();
  const blockedByDependants = new Map<EntityId, number>();

  for (const topic of topics) {
    blockedByDependants.set(topic.id, 0);
    for (const dependencyId of topic.dependencyIds) {
      if (!ids.has(dependencyId)) continue;
      dependants.set(dependencyId, [...(dependants.get(dependencyId) ?? []), topic.id]);
      blockedByDependants.set(dependencyId, (blockedByDependants.get(dependencyId) ?? 0) + 1);
    }
  }

  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const ready = topics.filter((topic) => (blockedByDependants.get(topic.id) ?? 0) === 0);
  const result: Topic[] = [];

  while (ready.length) {
    ready.sort(compareTopics);
    const topic = ready.shift();
    if (!topic) break;
    result.push(topic);

    for (const dependencyId of topic.dependencyIds) {
      if (!byId.has(dependencyId)) continue;
      const count = (blockedByDependants.get(dependencyId) ?? 0) - 1;
      blockedByDependants.set(dependencyId, count);
      if (count === 0) {
        const dependency = byId.get(dependencyId);
        if (dependency) ready.push(dependency);
      }
    }
  }

  // Imported documents are validated, but a corrupt legacy cycle should still
  // produce a deterministic infeasibility instead of making the planner crash.
  const visited = new Set(result.map((topic) => topic.id));
  result.push(...topics.filter((topic) => !visited.has(topic.id)).sort(compareTopics));
  return result;
}

function compareTopics(left: Topic, right: Topic): number {
  return (
    PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
    left.order - right.order ||
    left.id.localeCompare(right.id)
  );
}

function dependantsOf(topicId: EntityId, topics: readonly Topic[]): EntityId[] {
  return topics
    .filter((topic) => topic.dependencyIds.includes(topicId))
    .map((topic) => topic.id);
}

function roundUnits(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
