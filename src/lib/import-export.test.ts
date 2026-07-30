import { describe, expect, it } from "vitest";
import { sequentialIdFactory } from "@/data/ids";
import { course, plan, snapshot, topic } from "@/test/factories";
import {
  EXPORT_VERSION,
  exportFilename,
  ImportError,
  parsePlannerJson,
  serializePlans,
  toPlans,
} from "./import-export";

const fixture = () =>
  snapshot({
    plans: [
      plan({
        id: "plan_a",
        name: "Winter semester",
        startDate: "2026-09-01",
        endDate: "2027-02-28",
        courses: [
          course({
            id: "course_a",
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
                section: "Metabolism",
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
                section: "Metabolism",
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
      // Points at a topic that is not in the snapshot.
      { id: "log_orphan", topicId: "topic_gone", date: "2026-09-21", units: 10 },
    ],
  });

describe("serializePlans", () => {
  it("carries dependencies as topic names, not ids", () => {
    // Ids are account-scoped; names make a file importable anywhere.
    const document = serializePlans(fixture());
    expect(document.plans[0].courses[0].topics[1].dependencies).toEqual(["Glycolysis"]);
    expect(JSON.stringify(document)).not.toContain("topic_a");
  });

  it("also carries stable export-local refs for repeated topic names", () => {
    const document = serializePlans(fixture());
    const [glycolysis, krebs] = document.plans[0].courses[0].topics;

    expect(glycolysis.ref).toBe("p0:c0:t0");
    expect(krebs.dependencyRefs).toEqual(["p0:c0:t0"]);
    expect(document.studyLog[0].topicRef).toBe("p0:c0:t0");
  });

  it("resolves log entries to a course and topic name", () => {
    const document = serializePlans(fixture());
    expect(document.studyLog).toEqual([
      {
        topicRef: "p0:c0:t0",
        courseName: "Biochemistry",
        topicName: "Glycolysis",
        date: "2026-09-20",
        units: 30,
        minutes: 60,
        note: undefined,
      },
    ]);
  });

  it("takes the export timestamp as an argument rather than reading the clock", () => {
    expect(serializePlans(fixture(), "2026-07-29T10:00:00Z").exportedAt).toBe(
      "2026-07-29T10:00:00Z",
    );
  });

  it("stamps the current format version", () => {
    expect(serializePlans(fixture()).version).toBe(EXPORT_VERSION);
  });

  it("includes scheduling preferences in the portable document", () => {
    expect(serializePlans(fixture()).preferences).toEqual(fixture().preferences);
  });
});

describe("parsePlannerJson", () => {
  it("accepts a document this build wrote", () => {
    const contents = JSON.stringify(serializePlans(fixture(), "2026-07-29T10:00:00Z"));
    expect(parsePlannerJson(contents).plans[0].name).toBe("Winter semester");
  });

  it("fills in every optional field with a default", () => {
    const parsed = parsePlannerJson(
      JSON.stringify({ version: EXPORT_VERSION, plans: [{ name: "Bare", courses: [] }] }),
    );
    expect(parsed.plans[0]).toMatchObject({ notes: "", courses: [] });
    expect(parsed.studyLog).toEqual([]);
  });

  it("rejects invalid JSON with a readable message", () => {
    expect(() => parsePlannerJson("{not json")).toThrow(ImportError);
    expect(() => parsePlannerJson("{not json")).toThrow("That file is not valid JSON.");
  });

  it("rejects a version this build cannot read", () => {
    // Version 1 held no unit counts, so anything rebuilt from it would have to
    // invent topic sizes.
    expect(() => parsePlannerJson(JSON.stringify({ version: 1, plans: [] }))).toThrow(
      "Unsupported export version 1",
    );
  });

  it("points at the offending field when the shape is wrong", () => {
    const contents = JSON.stringify({
      version: EXPORT_VERSION,
      plans: [{ name: "Semester", courses: [{ name: "" }] }],
    });
    expect(() => parsePlannerJson(contents)).toThrow(/plans\.0\.courses\.0\.name/);
  });
});

describe("toPlans", () => {
  it("restores dependencies from names, scoped to the course", () => {
    const document = serializePlans(fixture());
    const { plans } = toPlans(document, sequentialIdFactory());
    const [glycolysis, krebs] = plans[0].courses[0].topics;

    expect(krebs.dependencyIds).toEqual([glycolysis.id]);
    expect(glycolysis.dependencyIds).toEqual([]);
  });

  it("drops a dependency naming a topic that is not in the file", () => {
    const document = serializePlans(fixture());
    document.plans[0].courses[0].topics[1].dependencyRefs = undefined;
    document.plans[0].courses[0].topics[1].dependencies = ["Nowhere"];
    const { plans } = toPlans(document, sequentialIdFactory());
    expect(plans[0].courses[0].topics[1].dependencyIds).toEqual([]);
  });

  it("never lets a topic depend on itself", () => {
    const document = serializePlans(fixture());
    document.plans[0].courses[0].topics[0].dependencies = ["Glycolysis"];
    const { plans } = toPlans(document, sequentialIdFactory());
    expect(plans[0].courses[0].topics[0].dependencyIds).toEqual([]);
  });

  it("resolves dependencies by ref when names repeat", () => {
    const original = fixture();
    const first = original.plans[0].courses[0].topics[0];
    const repeated = topic({
      id: "topic_repeat",
      courseId: first.courseId,
      name: first.name,
      order: 2,
      dependencyIds: [first.id],
    });
    original.plans[0].courses[0].topics.push(repeated);

    const { plans } = toPlans(serializePlans(original), sequentialIdFactory());
    const imported = plans[0].courses[0].topics;

    expect(imported[2].name).toBe(imported[0].name);
    expect(imported[2].dependencyIds).toEqual([imported[0].id]);
    expect(imported[2].dependencyIds).not.toEqual([imported[2].id]);
  });

  it("assigns order from position in the file", () => {
    const { plans } = toPlans(serializePlans(fixture()), sequentialIdFactory());
    expect(plans[0].courses[0].topics.map((item) => item.order)).toEqual([0, 1]);
  });

  it("round-trips everything except the ids", () => {
    const original = fixture();
    const { plans } = toPlans(serializePlans(original), sequentialIdFactory());

    // Ids are reassigned on import by design, so they and every reference to
    // them come out. That dependencies survive the trip is asserted above.
    const ID_KEYS = new Set(["id", "planId", "courseId", "topicId", "dependencyIds"]);
    const strip = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, inner: unknown) => (ID_KEYS.has(key) ? undefined : inner)),
      ) as unknown;

    expect(strip(plans)).toEqual(strip(original.plans));
  });
});

describe("exportFilename", () => {
  it("names the file after the date", () => {
    expect(exportFilename("2026-07-29")).toBe("study-planner-2026-07-29.json");
  });
});
