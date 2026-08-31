import {
  eachDayInclusive,
  schedule,
  type Course,
  type IsoDate,
  type PlannedBlock,
  type Schedule,
  type StudyCalendar,
} from "@/domain";

type PlannedDateRange = Pick<PlannedBlock, "startDate" | "endDate">;

/** Counts distinct calendar days covered by the planned ranges, including both endpoints. */
export function countDaysTouched(blocks: readonly PlannedDateRange[]): number {
  const days = new Set<IsoDate>();

  for (const block of blocks) {
    for (const day of eachDayInclusive(block.startDate, block.endDate)) {
      days.add(day);
    }
  }

  return days.size;
}

export type PlanningPreview = {
  result: Schedule;
  topicIds: string[];
  days: number;
};

/** Builds every derived value shown by the planning sheet in one explicit boundary. */
export function createPlanningPreview({
  courses,
  today,
  calendar,
  dailyCapacityUnits,
}: {
  courses: readonly Course[];
  today: IsoDate;
  calendar: StudyCalendar;
  dailyCapacityUnits: number;
}): PlanningPreview {
  const result = schedule({ courses, today, calendar, dailyCapacityUnits });

  return {
    result,
    topicIds: courses.flatMap((course) => course.topics.map((topic) => topic.id)),
    days: countDaysTouched(result.blocks),
  };
}
