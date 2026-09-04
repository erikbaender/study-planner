import { describe, expect, it } from "vitest";
import { course, plan, snapshot, topic } from "@/test/factories";
import {
  EXPORT_VERSION,
  exportFilename,
  PlannerTransferError,
  serializePlans,
} from "./planner-transfer";

function fixture() {
  return snapshot({
    plans: [
      plan({
        id: "plan_a",
        name: "Winter semester",
        courses: [
          course({
            id: "course_a",
            planId: "plan_a",
            name: "Biochemistry",
            code: "BIO-201",
            exams: [
              {
                id: "exam_a",
                courseId: "course_a",
                name: "Final",
                kind: "exam",
                startDate: "2026-12-10",
                endDate: "2026-12-17",
                status: "provisional",
                notes: "Window announced.",
                order: 0,
              },
            ],
            topics: [
              topic({
                id: "topic_a",
                courseId: "course_a",
                name: "Glycolysis",
                unit: "pages",
                totalUnits: 120,
                completedUnits: 30,
                status: "active",
                order: 0,
                blocks: [
                  {
                    id: "block_a",
                    topicId: "topic_a",
                    startDate: "2026-10-01",
                    endDate: "2026-10-03",
                    plannedUnits: 40,
                    source: "manual",
                  },
                ],
              }),
              topic({
                id: "topic_b",
                courseId: "course_a",
                name: "Citric acid cycle",
                unit: "pages",
                totalUnits: 80,
                order: 1,
                dependencyIds: ["topic_a"],
              }),
            ],
          }),
        ],
      }),
    ],
    studyLog: [
      { id: "log_a", topicId: "topic_a", date: "2026-09-20", units: 30, minutes: 60 },
      { id: "log_orphan", topicId: "topic_gone", date: "2026-09-21", units: 10 },
    ],
  });
}

describe("planner transfer serialization", () => {
  it("uses document-local topic keys for dependencies and logs", () => {
    const document = serializePlans(fixture());
    const [first, second] = document.plans[0].courses[0].topics;

    expect(first.key).toBe("topic_0");
    expect(second.dependencies).toEqual([first.key]);
    expect(second.dependencies).not.toContain("topic_a");
    expect(document.studyLog).toEqual([
      {
        topicKey: first.key,
        date: "2026-09-20",
        units: 30,
        minutes: 60,
        note: undefined,
      },
    ]);
  });

  it("round-trips duplicate names across plans, courses, and topics without collisions", () => {
    const duplicateSnapshot = snapshot({
      plans: [
        plan({
          id: "plan_1",
          name: "Same plan",
          courses: [
            course({
              id: "course_1",
              planId: "plan_1",
              name: "Same course",
              topics: [
                topic({ id: "topic_1", courseId: "course_1", name: "Same topic" }),
                topic({
                  id: "topic_2",
                  courseId: "course_1",
                  name: "Same topic",
                  dependencyIds: ["topic_1"],
                  order: 1,
                }),
              ],
            }),
          ],
        }),
        plan({
          id: "plan_2",
          name: "Same plan",
          courses: [
            course({
              id: "course_2",
              planId: "plan_2",
              name: "Same course",
              topics: [topic({ id: "topic_3", courseId: "course_2", name: "Same topic" })],
            }),
          ],
        }),
      ],
      studyLog: [
        { id: "log_1", topicId: "topic_1", date: "2026-08-01", units: 1 },
        { id: "log_2", topicId: "topic_2", date: "2026-08-02", units: 2 },
        { id: "log_3", topicId: "topic_3", date: "2026-08-03", units: 3 },
      ],
    });

    const document = serializePlans(duplicateSnapshot);
    const allKeys = document.plans.flatMap((item) =>
      item.courses.flatMap((itemCourse) => itemCourse.topics.map((itemTopic) => itemTopic.key)),
    );

    expect(new Set(allKeys).size).toBe(3);
    expect(document.studyLog.map((entry) => entry.units)).toEqual([1, 2, 3]);
    expect(new Set(document.studyLog.map((entry) => entry.topicKey))).toEqual(new Set(allKeys));
    expect(document.plans[0].courses[0].topics[1].dependencies).toEqual([
      document.plans[0].courses[0].topics[0].key,
    ]);
  });

  it("drops only orphan logs and refuses other broken internal references", () => {
    expect(serializePlans(fixture()).studyLog).toHaveLength(1);

    const brokenDependency = fixture();
    brokenDependency.plans[0].courses[0].topics[1].dependencyIds = ["topic_gone"];
    expect(() => serializePlans(brokenDependency)).toThrow(PlannerTransferError);
    expect(() => serializePlans(brokenDependency)).toThrow("not in its course");

    const brokenCourse = fixture();
    brokenCourse.plans[0].courses[0].planId = "another_plan";
    expect(() => serializePlans(brokenCourse)).toThrow("plan reference");

    const brokenExam = fixture();
    brokenExam.plans[0].courses[0].exams[0].courseId = "another_course";
    expect(() => serializePlans(brokenExam)).toThrow("course reference");

    const brokenTopic = fixture();
    brokenTopic.plans[0].courses[0].topics[0].courseId = "another_course";
    expect(() => serializePlans(brokenTopic)).toThrow("course reference");

    const brokenBlock = fixture();
    brokenBlock.plans[0].courses[0].topics[0].blocks[0].topicId = "topic_b";
    expect(() => serializePlans(brokenBlock)).toThrow("topic reference");
  });

  it("rejects control characters in required display text", () => {
    const invalid = fixture();
    invalid.plans[0].courses[0].topics[0].name = "Unsafe\0name";
    expect(() => serializePlans(invalid)).toThrow("control characters");
  });

  it("stamps v3 and uses caller-supplied date metadata", () => {
    const document = serializePlans(fixture(), "2026-07-29T10:00:00Z");
    expect(document.version).toBe(EXPORT_VERSION);
    expect(document.exportedAt).toBe("2026-07-29T10:00:00Z");
    expect(exportFilename("2026-07-29")).toBe("study-planner-2026-07-29.json");
  });
});
