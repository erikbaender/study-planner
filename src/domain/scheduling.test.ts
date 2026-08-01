import { describe, expect, it } from "vitest";
import { course as makeCourse, exam as makeExam, topic as makeTopic } from "@/test/factories";
import { DEFAULT_PREFERENCES } from "./types";
import { describeShortfall, schedule } from "./scheduling";

const TODAY = "2026-05-04"; // a Monday
/** Every day a study day, so the tests are about the algorithm and not the calendar. */
const EVERY_DAY = { ...DEFAULT_PREFERENCES, studyDaysOfWeek: [0, 1, 2, 3, 4, 5, 6] as const };

function plan(courses: Parameters<typeof schedule>[0]["courses"], capacity = 10) {
  return schedule({
    courses,
    today: TODAY,
    calendar: { ...EVERY_DAY, studyDaysOfWeek: [...EVERY_DAY.studyDaysOfWeek] },
    dailyCapacityUnits: capacity,
  });
}

describe("schedule", () => {
  it("fills days at capacity and stops when the work runs out", () => {
    const topic = makeTopic({ name: "Glycolysis", totalUnits: 25 });
    const result = plan([
      makeCourse({ topics: [topic], exams: [makeExam({ startDate: "2026-06-01" })] }),
    ]);

    // Consecutive filled days are one block, not one block per day: forty bars
    // for one topic reads as forty tasks.
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      topicId: topic.id,
      startDate: TODAY,
      endDate: "2026-05-06",
      plannedUnits: 25,
    });
    expect(result.shortfalls).toEqual([]);
  });

  it("puts no work on a day that is not a study day", () => {
    const topic = makeTopic({ totalUnits: 20 });
    const result = schedule({
      courses: [makeCourse({ topics: [topic], exams: [makeExam({ startDate: "2026-06-01" })] })],
      today: TODAY,
      // Mondays only.
      calendar: { ...DEFAULT_PREFERENCES, studyDaysOfWeek: [1] },
      dailyCapacityUnits: 10,
    });

    // The bar spans both Mondays rather than splitting: a task that runs over a
    // weekend is drawn as one bar in every Gantt chart there has ever been, and
    // splitting on every non-study day would give a two-month topic sixteen
    // bars. What matters is that the *capacity* of the days between is never
    // spent, which is what the units say.
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      startDate: "2026-05-04",
      endDate: "2026-05-11",
      plannedUnits: 20,
    });
  });

  it("gives the nearer deadline the earlier days", () => {
    // A day spent on an exam two months out is a day taken from one next week.
    const soon = makeCourse({
      name: "Soon",
      topics: [makeTopic({ name: "Soon topic", totalUnits: 10 })],
      exams: [makeExam({ startDate: "2026-05-10" })],
    });
    const later = makeCourse({
      name: "Later",
      topics: [makeTopic({ name: "Later topic", totalUnits: 10 })],
      exams: [makeExam({ startDate: "2026-08-10" })],
    });

    const result = plan([later, soon]);
    const first = result.blocks.find((block) => block.startDate === TODAY)!;
    expect(first.topicId).toBe(soon.topics[0].id);
  });

  it("does not plan the same day twice across courses", () => {
    const a = makeCourse({
      topics: [makeTopic({ totalUnits: 10 })],
      exams: [makeExam({ startDate: "2026-05-20" })],
    });
    const b = makeCourse({
      topics: [makeTopic({ totalUnits: 10 })],
      exams: [makeExam({ startDate: "2026-05-20" })],
    });

    const result = plan([a, b], 10);
    const perDay = new Map<string, number>();
    for (const block of result.blocks) {
      // Every block here is a single day at this capacity.
      perDay.set(block.startDate, (perDay.get(block.startDate) ?? 0) + block.plannedUnits);
    }
    expect([...perDay.values()].every((units) => units <= 10)).toBe(true);
  });

  it("leaves hand-placed blocks alone and plans around them", () => {
    // Reflow must never move or overwrite a `manual` block, and the material it
    // already covers must not be scheduled a second time.
    const topic = makeTopic({
      totalUnits: 30,
      blocks: [
        {
          id: "manual-1",
          topicId: "t",
          startDate: TODAY,
          endDate: TODAY,
          plannedUnits: 10,
          source: "manual",
        },
      ],
    });
    const result = plan([
      makeCourse({ topics: [topic], exams: [makeExam({ startDate: "2026-06-01" })] }),
    ]);

    expect(result.blocks.some((block) => block.startDate === TODAY)).toBe(false);
    expect(result.blocks.reduce((sum, block) => sum + block.plannedUnits, 0)).toBe(20);
  });

  it("excludes work already done", () => {
    const topic = makeTopic({ totalUnits: 100, completedUnits: 90 });
    const result = plan([
      makeCourse({ topics: [topic], exams: [makeExam({ startDate: "2026-06-01" })] }),
    ]);
    expect(result.blocks.reduce((sum, block) => sum + block.plannedUnits, 0)).toBe(10);
  });

  it("ignores topics whose size nobody has stated", () => {
    // Scheduling a topic of unknown size means inventing a number for it.
    const result = plan([
      makeCourse({
        topics: [makeTopic({ totalUnits: 0 })],
        exams: [makeExam({ startDate: "2026-06-01" })],
      }),
    ]);
    expect(result.blocks).toEqual([]);
  });

  it("reports a shortfall instead of throwing, and still plans what fits", () => {
    // §6: failure is an output. Throwing leaves the UI nothing to show, and
    // silently returning an impossible plan is worse than either.
    const course = makeCourse({
      name: "Biochemistry",
      topics: [makeTopic({ totalUnits: 500 })],
      exams: [makeExam({ startDate: "2026-05-08" })],
    });

    const result = plan([course], 10);

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.shortfalls).toHaveLength(1);
    expect(result.shortfalls[0]).toMatchObject({
      courseName: "Biochemistry",
      unscheduledUnits: 450,
      requiredCapacity: 100,
    });
  });

  it("says the shortfall in the shape the plan asks for", () => {
    const sentence = describeShortfall(
      {
        courseId: "c",
        courseName: "Biochemistry",
        deadline: "2026-05-08",
        unscheduledUnits: 780,
        requiredCapacity: 62,
      },
      40,
    );
    expect(sentence).toBe(
      "Biochemistry needs 62 units a day to finish in time; your capacity is 40. You are 780 units over.",
    );
  });

  it("does not blame capacity for a shortfall that is contention", () => {
    // "Needs 5 a day, your capacity is 40, you are 124 over" is a contradiction.
    // A course that fits on its own lost days to nearer exams, and that is a
    // different problem with a different answer.
    const sentence = describeShortfall(
      {
        courseId: "c",
        courseName: "Immunology",
        deadline: "2026-09-11",
        unscheduledUnits: 124,
        requiredCapacity: 5,
      },
      40,
    );
    expect(sentence).toBe(
      "Immunology would fit on its own at 5 units a day, but 124 units lost their place to courses with nearer exams.",
    );
  });

  it("plans a course with no exam against a horizon rather than not at all", () => {
    const result = plan([makeCourse({ topics: [makeTopic({ totalUnits: 20 })], exams: [] })]);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.shortfalls).toEqual([]);
  });

  it("is deterministic", () => {
    // No clock, no randomness: the same inputs must give the same plan, or
    // reflowing twice would move every bar.
    const courses = [
      makeCourse({
        topics: [makeTopic({ totalUnits: 40 }), makeTopic({ totalUnits: 30 })],
        exams: [makeExam({ startDate: "2026-06-01" })],
      }),
    ];
    expect(plan(courses)).toEqual(plan(courses));
  });
});
