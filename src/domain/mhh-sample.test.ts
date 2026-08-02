import { describe, expect, it } from "vitest";
import { assessCourse, studyStreak } from "./metrics";
import { generateMhhSampleData, generateMhhShowcaseData } from "./mhh-sample";
import { generateSampleDataset, SAMPLE_DATASETS } from "./sample-datasets";

const TODAY = "2026-08-02";

describe("generateMhhSampleData", () => {
  it("captures the importable GitHub Project data", () => {
    const data = generateMhhSampleData();
    const topics = data.plan.courses.flatMap((course) => course.topics);
    const blocks = topics.flatMap((topic) => topic.blocks);

    expect(data.plan.name).toBe("Lernplan");
    expect(data.plan.courses).toHaveLength(7);
    expect(topics).toHaveLength(89);
    expect(blocks).toHaveLength(86);
    expect(topics.some((topic) => /^Teil\s+\d+/i.test(topic.name))).toBe(false);
  });

  it("preserves source names, statuses, dates and milestone deadlines", () => {
    const data = generateMhhSampleData();
    const biochemie = data.plan.courses.find((course) => course.name === "Biochemie")!;
    const einfuehrung = biochemie.topics.find((topic) => topic.name === "Einführung")!;
    const wiederholung = biochemie.topics.find((topic) => topic.name === "Wiederholung")!;

    expect(biochemie.exams[0].startDate).toBe("2026-07-16");
    expect(einfuehrung).toMatchObject({ status: "done", completedUnits: 1 });
    expect(einfuehrung.blocks[0]).toMatchObject({
      startDate: "2026-03-16",
      endDate: "2026-03-22",
      source: "manual",
    });
    expect(wiederholung).toMatchObject({ status: "planned", completedUnits: 0 });
  });

  it("gives every captured entity a unique id", () => {
    const data = generateMhhSampleData();
    const ids = [
      data.plan.id,
      ...data.plan.courses.flatMap((course) => [
        course.id,
        ...course.exams.map((exam) => exam.id),
        ...course.topics.flatMap((topic) => [topic.id, ...topic.blocks.map((block) => block.id)]),
      ]),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("generateMhhShowcaseData", () => {
  it("keeps the real course and topic outline", () => {
    const source = generateMhhSampleData();
    const showcase = generateMhhShowcaseData(TODAY);

    expect(showcase.plan.courses.map((course) => course.name)).toEqual(
      source.plan.courses.map((course) => course.name),
    );
    expect(showcase.plan.courses.map((course) => course.topics.map((topic) => topic.name))).toEqual(
      source.plan.courses.map((course) => course.topics.map((topic) => topic.name)),
    );
  });

  it("adds varied, useful workload and planning states", () => {
    const data = generateMhhShowcaseData(TODAY);
    const topics = data.plan.courses.flatMap((course) => course.topics);
    const blocks = topics.flatMap((topic) => topic.blocks);

    expect(new Set(topics.map((topic) => topic.unit))).toEqual(
      new Set(["slides", "pages", "cards", "videos", "hours"]),
    );
    expect(new Set(topics.map((topic) => topic.status))).toEqual(
      new Set(["done", "active", "planned"]),
    );
    expect(new Set(topics.map((topic) => topic.priority))).toEqual(
      new Set(["high", "normal", "low"]),
    );
    expect(topics.every((topic) => topic.totalUnits > 1)).toBe(true);
    expect(topics.some((topic) => topic.dependencyIds.length > 0)).toBe(true);
    expect(new Set(blocks.map((block) => block.source))).toEqual(new Set(["manual", "auto"]));
    expect(topics.some((topic) => topic.blocks.length === 0 && topic.status === "planned")).toBe(
      true,
    );
  });

  it("creates a believable current scenario with most courses on track", () => {
    const data = generateMhhShowcaseData(TODAY);
    const preferences = data.preferences!;
    const health = data.plan.courses.map((course) =>
      assessCourse({
        course,
        today: TODAY,
        calendar: preferences,
        log: data.studyLog,
        dailyCapacityUnits: preferences.dailyCapacityUnits,
      }),
    );
    const behind = health.filter((course) => !course.pace?.onTrack);

    expect(behind.map((course) => course.courseId)).toEqual([
      "course_sample_mhh_showcase_0",
      "course_sample_mhh_showcase_2",
    ]);
    expect(health.filter((course) => course.pace?.onTrack)).toHaveLength(5);
    expect(health.every((course) => course.exam!.startDate > TODAY)).toBe(true);
    expect(data.plan.courses.filter((course) => course.exams[0].status === "provisional")).toHaveLength(
      2,
    );
  });

  it("includes recent study history, a streak, capacity and a day off", () => {
    const data = generateMhhShowcaseData(TODAY);

    expect(data.studyLog.length).toBeGreaterThan(30);
    expect(studyStreak(data.studyLog, TODAY, data.preferences!)).toBeGreaterThanOrEqual(5);
    expect(data.preferences).toMatchObject({ dailyCapacityUnits: 60 });
    expect(data.preferences!.blackoutDates).toHaveLength(1);
  });
});

describe("sample dataset registry", () => {
  it("keeps both existing fixtures and offers the showcase beside them", () => {
    expect(SAMPLE_DATASETS.map((dataset) => dataset.id)).toEqual([
      "generated",
      "mhh-lernplan",
      "mhh-showcase",
    ]);
    expect(generateSampleDataset("generated", "2026-07-29").plan.courses).toHaveLength(10);
    expect(generateSampleDataset("mhh-lernplan", "2026-07-29").plan.courses).toHaveLength(7);
    expect(generateSampleDataset("mhh-showcase", "2026-07-29").plan.courses).toHaveLength(7);
  });
});
