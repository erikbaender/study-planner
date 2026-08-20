import { describe, expect, it } from "vitest";
import { ImportError, parsePlannerJson } from "./import-export";
import {
  EXPORT_VERSION,
  MAX_PLANNER_IMPORT_BYTES,
  PLANNER_TRANSFER_LIMITS,
  type PlannerTransferDocument,
  type TransferredTopic,
} from "./planner-transfer";

function transferredTopic(
  key: string,
  overrides: Partial<TransferredTopic> = {},
): TransferredTopic {
  return {
    key,
    name: `Topic ${key}`,
    unit: "slides",
    totalUnits: 100,
    completedUnits: 10,
    status: "active",
    priority: "normal",
    color: "violet",
    notes: "",
    dependencies: [],
    blocks: [],
    ...overrides,
  };
}

function v3Document(): PlannerTransferDocument {
  return {
    version: EXPORT_VERSION,
    exportedAt: "2026-08-20T12:00:00.000Z",
    plans: [
      {
        name: "Semester",
        notes: "",
        courses: [
          {
            name: "Course",
            code: "BIO-201",
            color: "violet",
            notes: "",
            exams: [
              {
                name: "Final",
                kind: "exam",
                startDate: "2026-12-10",
                endDate: "2026-12-17",
                status: "provisional",
                notes: "",
              },
            ],
            topics: [
              transferredTopic("foundations", {
                name: "Foundations",
                blocks: [
                  {
                    startDate: "2026-09-01",
                    endDate: "2026-09-02",
                    plannedUnits: 10,
                    source: "manual",
                  },
                ],
              }),
              transferredTopic("advanced", {
                name: "Advanced",
                dependencies: ["foundations"],
              }),
            ],
          },
        ],
      },
    ],
    studyLog: [
      {
        topicKey: "foundations",
        date: "2026-08-20",
        units: 5,
        minutes: 30,
        note: "Review",
      },
    ],
  };
}

function cloneDocument(): PlannerTransferDocument {
  return JSON.parse(JSON.stringify(v3Document())) as PlannerTransferDocument;
}

function v2Document() {
  return {
    version: 2,
    exportedAt: "2026-08-20T12:00:00.000Z",
    plans: [
      {
        name: "Semester",
        courses: [
          {
            name: "Course",
            color: "#5856d6",
            topics: [
              { name: "Foundations", section: "Basics" },
              { name: "Advanced", dependencies: ["Foundations"] },
            ],
          },
        ],
      },
    ],
    studyLog: [
      {
        courseName: "Course",
        topicName: "Foundations",
        date: "2026-08-20",
        units: 5,
      },
    ],
  };
}

describe("parsePlannerJson", () => {
  it("strictly parses a canonical v3 document", () => {
    const parsed = parsePlannerJson(JSON.stringify(v3Document()));
    expect(parsed).toEqual(v3Document());

    const withUnknownField = { ...v3Document(), unexpected: true };
    expect(() => parsePlannerJson(JSON.stringify(withUnknownField))).toThrow("Unrecognized key");
  });

  it("canonicalizes an unambiguous v2 document to v3 keys", () => {
    const parsed = parsePlannerJson(JSON.stringify(v2Document()));
    const [foundations, advanced] = parsed.plans[0].courses[0].topics;

    expect(parsed.version).toBe(EXPORT_VERSION);
    expect(foundations).not.toHaveProperty("section");
    expect(advanced.dependencies).toEqual([foundations.key]);
    expect(parsed.studyLog[0].topicKey).toBe(foundations.key);
    expect(foundations.color).toBe("violet");
  });

  it("rejects ambiguous v2 dependency names", () => {
    const legacy = v2Document();
    legacy.plans[0].courses[0].topics = [
      { name: "Same", section: "One" },
      { name: "Same", section: "Two" },
      { name: "Consumer", dependencies: ["Same"] },
    ];
    legacy.studyLog = [];

    expect(() => parsePlannerJson(JSON.stringify(legacy))).toThrow(ImportError);
    expect(() => parsePlannerJson(JSON.stringify(legacy))).toThrow(
      "dependency Same is ambiguous",
    );
  });

  it("rejects ambiguous v2 study-log paths across duplicate plans or courses", () => {
    const legacy = v2Document();
    legacy.plans.push(JSON.parse(JSON.stringify(legacy.plans[0])) as (typeof legacy.plans)[number]);

    expect(() => parsePlannerJson(JSON.stringify(legacy))).toThrow(
      "study log path Course / Foundations is ambiguous",
    );
  });

  it("rejects missing v2 dependencies and study-log paths", () => {
    const missingDependency = v2Document();
    missingDependency.plans[0].courses[0].topics[1].dependencies = ["Nowhere"];
    expect(() => parsePlannerJson(JSON.stringify(missingDependency))).toThrow(
      "dependency Nowhere does not name a topic",
    );

    const missingLog = v2Document();
    missingLog.studyLog[0].topicName = "Nowhere";
    expect(() => parsePlannerJson(JSON.stringify(missingLog))).toThrow(
      "study log path Course / Nowhere is missing",
    );
  });

  it("rejects control-character legacy names instead of constructing path keys", () => {
    const legacy = v2Document();
    legacy.plans[0].courses[0].name = "Course\0Topic";
    expect(() => parsePlannerJson(JSON.stringify(legacy))).toThrow("control characters");
  });

  it("does not support v1 or unknown versions", () => {
    expect(() => parsePlannerJson(JSON.stringify({ version: 1, plans: [] }))).toThrow(
      "Unsupported export version 1",
    );
    expect(() => parsePlannerJson(JSON.stringify({ version: 4, plans: [] }))).toThrow(
      "Unsupported export version 4",
    );
  });

  it("rejects duplicate, missing, cross-course, and unsafe topic keys", () => {
    const duplicate = cloneDocument();
    duplicate.plans[0].courses[0].topics[1].key = "foundations";
    expect(() => parsePlannerJson(JSON.stringify(duplicate))).toThrow("duplicated");

    const missing = cloneDocument();
    missing.plans[0].courses[0].topics[1].dependencies = ["missing"];
    expect(() => parsePlannerJson(JSON.stringify(missing))).toThrow("missing topic key missing");

    const crossCourse = cloneDocument();
    crossCourse.plans[0].courses.push({
      name: "Other course",
      color: "rose",
      notes: "",
      exams: [],
      topics: [transferredTopic("other")],
    });
    crossCourse.plans[0].courses[0].topics[1].dependencies = ["other"];
    expect(() => parsePlannerJson(JSON.stringify(crossCourse))).toThrow(
      "dependency outside its course",
    );

    const unsafe = cloneDocument();
    unsafe.plans[0].courses[0].topics[0].key = "unsafe.key";
    expect(() => parsePlannerJson(JSON.stringify(unsafe))).toThrow("letters, numbers");

    const unsafeName = cloneDocument();
    unsafeName.plans[0].courses[0].topics[0].name = "Unsafe\0name";
    expect(() => parsePlannerJson(JSON.stringify(unsafeName))).toThrow("control characters");
  });

  it("rejects dependency cycles and dangling study-log references", () => {
    const cycle = cloneDocument();
    cycle.plans[0].courses[0].topics[0].dependencies = ["advanced"];
    expect(() => parsePlannerJson(JSON.stringify(cycle))).toThrow("dependency cycle");

    const missingLog = cloneDocument();
    missingLog.studyLog[0].topicKey = "missing";
    expect(() => parsePlannerJson(JSON.stringify(missingLog))).toThrow(
      "references missing topic key missing",
    );
  });

  it("rejects impossible, malformed, and reversed dates", () => {
    const impossible = cloneDocument();
    impossible.studyLog[0].date = "2026-02-29";
    expect(() => parsePlannerJson(JSON.stringify(impossible))).toThrow("real date");

    const malformed = cloneDocument();
    malformed.studyLog[0].date = "2026-2-09";
    expect(() => parsePlannerJson(JSON.stringify(malformed))).toThrow("real date");

    const reversed = cloneDocument();
    reversed.plans[0].courses[0].topics[0].blocks[0].endDate = "2026-08-31";
    expect(() => parsePlannerJson(JSON.stringify(reversed))).toThrow(
      "End date cannot be before the start date",
    );
  });

  it("rejects non-finite and invalid progress numbers", () => {
    const nonFiniteJson = JSON.stringify(v3Document()).replace('"units":5', '"units":1e999');
    expect(() => parsePlannerJson(nonFiniteJson)).toThrow("finite number");

    const invalidProgress = cloneDocument();
    invalidProgress.plans[0].courses[0].topics[0].completedUnits = 101;
    invalidProgress.plans[0].courses[0].topics[0].totalUnits = 100;
    expect(() => parsePlannerJson(JSON.stringify(invalidProgress))).toThrow(
      "Completed units cannot exceed the total",
    );
  });

  it("enforces field, array, and whole-file size limits", () => {
    const longText = cloneDocument();
    longText.plans[0].notes = "x".repeat(PLANNER_TRANSFER_LIMITS.notesCharacters + 1);
    expect(() => parsePlannerJson(JSON.stringify(longText))).toThrow("Too big");

    const longArray = cloneDocument();
    longArray.studyLog = Array.from(
      { length: PLANNER_TRANSFER_LIMITS.importEntities + 1 },
      () => ({ topicKey: "foundations", date: "2026-08-20", units: 1 }),
    );
    expect(() => parsePlannerJson(JSON.stringify(longArray))).toThrow("Too big");

    expect(() => parsePlannerJson(" ".repeat(MAX_PLANNER_IMPORT_BYTES + 1))).toThrow(
      "5 MiB or smaller",
    );
  });

  it("enforces aggregate entity, reference, and text budgets", () => {
    const tooManyEntities = cloneDocument();
    tooManyEntities.plans[0].courses[0].exams = [];
    tooManyEntities.plans[0].courses[0].topics = Array.from(
      { length: PLANNER_TRANSFER_LIMITS.importEntities },
      (_, index) => transferredTopic(`entity_${index}`),
    );
    tooManyEntities.studyLog = [];
    expect(() => parsePlannerJson(JSON.stringify(tooManyEntities))).toThrow("records");

    const tooManyReferences = cloneDocument();
    const foundations = Array.from({ length: 500 }, (_, index) =>
      transferredTopic(`base_${index}`),
    );
    const dependents = Array.from({ length: 11 }, (_, index) =>
      transferredTopic(`dependent_${index}`, {
        dependencies: foundations.map((item) => item.key),
      }),
    );
    tooManyReferences.plans[0].courses[0].exams = [];
    tooManyReferences.plans[0].courses[0].topics = [...foundations, ...dependents];
    tooManyReferences.studyLog = [];
    expect(() => parsePlannerJson(JSON.stringify(tooManyReferences))).toThrow("references");

    const tooMuchText = cloneDocument();
    tooMuchText.plans = Array.from(
      { length: PLANNER_TRANSFER_LIMITS.importPlans },
      (_, index) => ({
        name: `Plan ${index}`,
        notes: "x".repeat(PLANNER_TRANSFER_LIMITS.notesCharacters),
        courses: [],
      }),
    );
    tooMuchText.studyLog = [];
    expect(() => parsePlannerJson(JSON.stringify(tooMuchText))).toThrow(
      "Import text cannot exceed",
    );
  });

  it("reports invalid JSON and the first invalid field readably", () => {
    expect(() => parsePlannerJson("{not json")).toThrow(ImportError);
    expect(() => parsePlannerJson("{not json")).toThrow("That file is not valid JSON.");

    const invalid = cloneDocument();
    invalid.plans[0].courses[0].name = "";
    expect(() => parsePlannerJson(JSON.stringify(invalid))).toThrow(
      /plans\.0\.courses\.0\.name/,
    );
  });
});
