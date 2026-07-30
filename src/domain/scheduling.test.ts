import { describe, expect, it } from "vitest";
import { course, exam, topic } from "@/test/factories";
import { scheduleCourses } from "./scheduling";
import type { Course, Preferences, StudyBlock } from "./types";

const TODAY = "2026-07-27";
const PREFERENCES: Pick<
  Preferences,
  "dailyCapacityUnits" | "studyDaysOfWeek" | "blackoutDates"
> = {
  dailyCapacityUnits: 40,
  studyDaysOfWeek: [1, 2, 3, 4, 5],
  blackoutDates: [],
};

function subject(topics: Course["topics"], deadline = "2026-07-31"): Course {
  const id = "course_subject";
  return course({
    id,
    order: 0,
    exams: [exam({ courseId: id, startDate: deadline })],
    topics: topics.map((item) => ({ ...item, courseId: id })),
  });
}

function schedule(courses: readonly Course[], dailyCapacityUnits?: number) {
  return scheduleCourses({
    courses,
    today: TODAY,
    preferences: PREFERENCES,
    dailyCapacityUnits,
  });
}

describe("scheduleCourses", () => {
  it("schedules remaining work backwards before the exam", () => {
    const result = schedule([
      subject([topic({ id: "topic_a", totalUnits: 100, completedUnits: 20 })]),
    ]);

    expect(result.feasible).toBe(true);
    expect(result.blocks).toEqual([
      {
        topicId: "topic_a",
        startDate: "2026-07-29",
        endDate: "2026-07-29",
        plannedUnits: 40,
      },
      {
        topicId: "topic_a",
        startDate: "2026-07-30",
        endDate: "2026-07-30",
        plannedUnits: 40,
      },
    ]);
  });

  it("respects study days and blackout dates", () => {
    const result = scheduleCourses({
      courses: [
        subject(
          [topic({ id: "topic_a", totalUnits: 80 })],
          "2026-08-04",
        ),
      ],
      today: TODAY,
      preferences: {
        ...PREFERENCES,
        blackoutDates: ["2026-07-31"],
      },
    });

    expect(result.blocks.map((block) => block.startDate)).toEqual([
      "2026-07-30",
      "2026-08-03",
    ]);
  });

  it("returns a configuration failure instead of guessing an unknown capacity", () => {
    const result = scheduleCourses({
      courses: [subject([topic({ totalUnits: 50 })])],
      today: TODAY,
      preferences: { ...PREFERENCES, dailyCapacityUnits: undefined },
    });

    expect(result).toMatchObject({
      blocks: [],
      capacityUnits: null,
      feasible: false,
      shortfallUnits: 50,
    });
    expect(result.courses[0].status).toBe("infeasible");
  });

  it("reports the exact shortfall when work does not fit", () => {
    const result = schedule([
      subject([topic({ id: "topic_a", totalUnits: 200 })]),
    ]);

    expect(result.feasible).toBe(false);
    expect(result.shortfallUnits).toBe(40);
    expect(result.courses[0]).toMatchObject({
      studyDays: 4,
      requiredDailyUnits: 50,
      scheduledUnits: 160,
      shortfallUnits: 40,
      status: "infeasible",
    });
  });

  it("gives scarce capacity to higher-priority independent work", () => {
    const result = schedule([
      subject([
        topic({ id: "topic_low", totalUnits: 120, priority: "low", order: 0 }),
        topic({ id: "topic_high", totalUnits: 120, priority: "high", order: 1 }),
      ]),
    ]);

    expect(
      result.blocks
        .filter((block) => block.topicId === "topic_high")
        .reduce((sum, block) => sum + block.plannedUnits, 0),
    ).toBe(120);
    expect(
      result.blocks
        .filter((block) => block.topicId === "topic_low")
        .reduce((sum, block) => sum + block.plannedUnits, 0),
    ).toBe(40);
  });

  it("finishes a prerequisite before scheduling its dependant", () => {
    const prerequisite = topic({
      id: "topic_first",
      totalUnits: 40,
      priority: "low",
      order: 0,
    });
    const dependant = topic({
      id: "topic_second",
      totalUnits: 40,
      priority: "high",
      dependencyIds: [prerequisite.id],
      order: 1,
    });
    const result = schedule([subject([prerequisite, dependant])]);
    const firstDate = result.blocks.find((block) => block.topicId === prerequisite.id)?.startDate;
    const secondDate = result.blocks.find((block) => block.topicId === dependant.id)?.startDate;

    expect(firstDate).toBe("2026-07-29");
    expect(secondDate).toBe("2026-07-30");
  });

  it("credits and reserves a measured manual placement without emitting it", () => {
    const manual: StudyBlock = {
      id: "block_manual",
      topicId: "topic_a",
      startDate: "2026-07-30",
      endDate: "2026-07-30",
      plannedUnits: 30,
      source: "manual",
    };
    const result = schedule([
      subject([topic({ id: "topic_a", totalUnits: 70, blocks: [manual] })]),
    ]);

    expect(result.blocks).toEqual([
      {
        topicId: "topic_a",
        startDate: "2026-07-29",
        endDate: "2026-07-29",
        plannedUnits: 30,
      },
      {
        topicId: "topic_a",
        startDate: "2026-07-30",
        endDate: "2026-07-30",
        plannedUnits: 10,
      },
    ]);
    expect(result.courses[0]).toMatchObject({ manualUnits: 30, scheduledUnits: 40 });
  });

  it("places a prerequisite before a manually scheduled dependant", () => {
    const prerequisite = topic({
      id: "topic_first",
      totalUnits: 40,
      order: 0,
    });
    const dependant = topic({
      id: "topic_second",
      totalUnits: 40,
      dependencyIds: [prerequisite.id],
      order: 1,
      blocks: [
        {
          id: "block_manual",
          topicId: "topic_second",
          startDate: "2026-07-30",
          endDate: "2026-07-30",
          plannedUnits: 40,
          source: "manual",
        },
      ],
    });
    const result = schedule([subject([prerequisite, dependant])], 80);

    expect(result.blocks).toEqual([
      {
        topicId: prerequisite.id,
        startDate: "2026-07-29",
        endDate: "2026-07-29",
        plannedUnits: 40,
      },
    ]);
  });

  it("protects an unmeasured manual placement without inventing its cost", () => {
    const manual: StudyBlock = {
      id: "block_manual",
      topicId: "topic_a",
      startDate: "2026-07-30",
      endDate: "2026-07-30",
      source: "manual",
    };
    const result = schedule([
      subject([topic({ id: "topic_a", totalUnits: 40, blocks: [manual] })]),
    ]);

    expect(result.unmeasuredManualBlockCount).toBe(1);
    expect(result.blocks).toHaveLength(1);
  });

  it("ignores finished and size-untracked topics, reporting the latter", () => {
    const result = schedule([
      subject([
        topic({ id: "done", totalUnits: 20, completedUnits: 20, status: "done" }),
        topic({ id: "unknown", totalUnits: 0 }),
      ]),
    ]);

    expect(result.blocks).toEqual([]);
    expect(result.unsizedTopicCount).toBe(1);
    expect(result.courses[0].status).toBe("nothing-to-schedule");
  });

  it("does not schedule a course without an upcoming exam", () => {
    const noExam = course({
      id: "course_no_exam",
      topics: [topic({ totalUnits: 40 })],
    });
    const result = schedule([noExam]);

    expect(result.blocks).toEqual([]);
    expect(result.courses[0]).toMatchObject({
      deadline: null,
      status: "no-deadline",
      remainingUnits: 40,
    });
  });

  it("uses the start of a provisional exam window as the deadline", () => {
    const item = subject([topic({ totalUnits: 40 })], "2026-07-31");
    item.exams[0] = {
      ...item.exams[0],
      status: "provisional",
      endDate: "2026-08-07",
    };

    expect(schedule([item]).courses[0].deadline).toBe("2026-07-31");
  });

  it("is deterministic and leaves every source entity untouched", () => {
    const input = subject([
      topic({ id: "topic_a", totalUnits: 80 }),
      topic({ id: "topic_b", totalUnits: 40 }),
    ]);
    const before = structuredClone(input);

    expect(schedule([input])).toEqual(schedule([input]));
    expect(input).toEqual(before);
  });
});
