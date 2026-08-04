import { describe, expect, it } from "vitest";
import { differenceInDays } from "./dates";
import { isCourseColorId } from "./palette";
import { generateSeedData } from "./seed";
import type { Topic } from "./types";

const TODAY = "2026-07-29";

const allTopics = (data: ReturnType<typeof generateSeedData>): Topic[] =>
  data.plan.courses.flatMap((course) => course.topics);

describe("generateSeedData", () => {
  it("is byte-identical across runs with the same options", () => {
    // The whole point of the seeded PRNG: without it no test could assert on
    // the fixture, and the timeline's virtualization would have a different
    // dataset on every reload.
    expect(generateSeedData({ today: TODAY })).toEqual(generateSeedData({ today: TODAY }));
  });

  it("produces different data for a different seed", () => {
    const a = generateSeedData({ today: TODAY, seed: 1 });
    const b = generateSeedData({ today: TODAY, seed: 2 });
    expect(allTopics(a).map((topic) => topic.totalUnits)).not.toEqual(
      allTopics(b).map((topic) => topic.totalUnits),
    );
  });

  it("builds the persona's worst case: ten courses and hundreds of topics", () => {
    const data = generateSeedData({ today: TODAY });
    expect(data.plan.courses).toHaveLength(10);
    // Pinned rather than bounded: the fixture size is what the timeline's
    // virtualization is tuned against, so it should not drift unnoticed.
    expect(allTopics(data)).toHaveLength(344);
  });

  it("stores palette references rather than rendered colour values", () => {
    const data = generateSeedData({ today: TODAY });
    const references = data.plan.courses.flatMap((course) => [
      course.color,
      ...course.topics.map((topic) => topic.color),
    ]);
    expect(references.every(isCourseColorId)).toBe(true);
    expect(references.every((color) => !color.startsWith("#"))).toBe(true);
  });

  it("trims to the requested number of courses", () => {
    const data = generateSeedData({ today: TODAY, courseLimit: 2 });
    expect(data.plan.courses.map((course) => course.code)).toEqual(["BIO-201", "PHY-202"]);
  });

  it("derives every date from the injected today", () => {
    // No date may come from the clock; the previous implementation hard-coded
    // one and silently rotted.
    const shifted = generateSeedData({ today: "2027-01-15" });
    const examDates = shifted.plan.courses.map((course) => course.exams[0].startDate);
    expect(examDates.every((date) => date > "2027-01-15")).toBe(true);
    expect(shifted.plan.startDate).toBe("2026-11-16");
  });

  it("gives provisional exams a window and confirmed ones a single day", () => {
    const data = generateSeedData({ today: TODAY });
    for (const course of data.plan.courses) {
      const exam = course.exams[0];
      if (exam.status === "provisional") {
        expect(exam.endDate).toBeDefined();
        expect(differenceInDays(exam.startDate, exam.endDate!)).toBe(6);
      } else {
        expect(exam.endDate).toBeUndefined();
      }
    }
    // Both kinds must be present or the UI's two renderings go untested.
    const statuses = new Set(data.plan.courses.map((course) => course.exams[0].status));
    expect(statuses).toEqual(new Set(["confirmed", "provisional"]));
  });

  it("keeps completion within the topic's size and consistent with its status", () => {
    for (const topic of allTopics(generateSeedData({ today: TODAY }))) {
      expect(topic.totalUnits).toBeGreaterThan(0);
      expect(topic.completedUnits).toBeGreaterThanOrEqual(0);
      expect(topic.completedUnits).toBeLessThanOrEqual(topic.totalUnits);
      expect(topic.status).toBe(
        topic.completedUnits >= topic.totalUnits
          ? "done"
          : topic.completedUnits > 0
            ? "active"
            : "planned",
      );
    }
  });

  it("only ever depends on a topic in the same course", () => {
    for (const course of generateSeedData({ today: TODAY }).plan.courses) {
      const ids = new Set(course.topics.map((topic) => topic.id));
      for (const topic of course.topics) {
        for (const dependencyId of topic.dependencyIds) {
          expect(ids.has(dependencyId)).toBe(true);
          expect(dependencyId).not.toBe(topic.id);
        }
      }
    }
  });

  it("places some manual blocks, so reflow has something to preserve from run one", () => {
    const blocks = allTopics(generateSeedData({ today: TODAY })).flatMap((topic) => topic.blocks);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((block) => block.source === "manual")).toBe(true);
    expect(blocks.every((block) => block.startDate <= block.endDate)).toBe(true);
  });

  it("logs two weeks of history so velocity is readable on first launch", () => {
    const data = generateSeedData({ today: TODAY });
    const topicIds = new Set(allTopics(data).map((topic) => topic.id));

    expect(data.studyLog.length).toBeGreaterThan(0);
    for (const entry of data.studyLog) {
      expect(topicIds.has(entry.topicId)).toBe(true);
      const age = differenceInDays(entry.date, TODAY);
      expect(age).toBeGreaterThanOrEqual(1);
      expect(age).toBeLessThanOrEqual(14);
      expect(entry.units).toBeGreaterThan(0);
    }
  });

  it("gives every entity a unique id", () => {
    const data = generateSeedData({ today: TODAY });
    const ids = [
      data.plan.id,
      ...data.plan.courses.flatMap((course) => [
        course.id,
        ...course.exams.map((exam) => exam.id),
        ...course.topics.flatMap((topic) => [topic.id, ...topic.blocks.map((block) => block.id)]),
      ]),
      ...data.studyLog.map((entry) => entry.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
