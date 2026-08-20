import { describe, expect, it } from "vitest";
import {
  assertAutoBlockReplacement,
  assertDistinctBoundedArray,
  assertFiniteBoundedNumber,
  assertImportPayload,
  assertIsoDate,
  assertOrderedIsoDates,
  assertPreferences,
  assertProgress,
  assertReorderComplete,
  assertScheduleApplication,
  assertTrimmedBoundedText,
  PLANNER_LIMITS,
  type ImportPlanGuardInput,
} from "./plannerGuards";

function topic(overrides: Partial<ImportPlanGuardInput["courses"][number]["topics"][number]> = {}) {
  return {
    key: "topic_0",
    name: "Topic",
    totalUnits: 100,
    completedUnits: 10,
    notes: "",
    dependencies: [],
    blocks: [],
    ...overrides,
  };
}

function plan(
  topics: ImportPlanGuardInput["courses"][number]["topics"] = [topic()],
  overrides: Partial<ImportPlanGuardInput> = {},
): ImportPlanGuardInput {
  return {
    name: "Semester",
    notes: "",
    courses: [
      {
        name: "Course",
        notes: "",
        exams: [],
        topics,
      },
    ],
    ...overrides,
  };
}

describe("planner scalar guards", () => {
  it("accepts real ISO days and rejects malformed or impossible dates", () => {
    expect(() => assertIsoDate("2028-02-29", "Date")).not.toThrow();
    expect(() => assertIsoDate("2026-02-29", "Date")).toThrow("real date");
    expect(() => assertIsoDate("2026-2-09", "Date")).toThrow("YYYY-MM-DD");
    expect(() => assertOrderedIsoDates("2026-08-20", "2026-08-19")).toThrow(
      "before the start date",
    );
  });

  it("rejects non-finite and out-of-range numbers", () => {
    expect(() => assertFiniteBoundedNumber(Number.NaN, "Value")).toThrow("finite");
    expect(() => assertFiniteBoundedNumber(Infinity, "Value")).toThrow("finite");
    expect(() => assertFiniteBoundedNumber(11, "Value", { max: 10 })).toThrow("exceed");
    expect(() => assertProgress(101, 100)).toThrow("Completed units");
    expect(() => assertProgress(40, 0)).not.toThrow();
    expect(() => assertProgress(PLANNER_LIMITS.units + 1, 0)).toThrow("cannot exceed");
  });

  it("requires canonical bounded names", () => {
    expect(() => assertTrimmedBoundedText("Topic", "Name", 10)).not.toThrow();
    expect(() => assertTrimmedBoundedText(" Topic ", "Name", 10)).toThrow("whitespace");
    expect(() => assertTrimmedBoundedText("Topic\0hidden", "Name", 20)).toThrow(
      "control characters",
    );
    expect(() => assertTrimmedBoundedText("too long", "Name", 3)).toThrow("exceed");
  });
});

describe("planner collection guards", () => {
  it("rejects duplicate and oversized arrays", () => {
    expect(() => assertDistinctBoundedArray(["a", "b"], "Ids", 2)).not.toThrow();
    expect(() => assertDistinctBoundedArray(["a", "a"], "Ids", 2)).toThrow("duplicates");
    expect(() => assertDistinctBoundedArray(["a", "b", "c"], "Ids", 2)).toThrow(
      "more than",
    );
  });

  it("validates a complete schedule application before server writes", () => {
    const blocks = [
      {
        topicId: "topic_1",
        startDate: "2026-08-20",
        endDate: "2026-08-21",
        plannedUnits: 20,
      },
    ];
    const preferences = {
      dailyCapacityUnits: 50,
      studyDaysOfWeek: [1, 3, 5],
      blackoutDates: ["2026-12-24"],
      accentColor: "#1769e0",
    };

    expect(() => assertScheduleApplication(["topic_1"], blocks, preferences)).not.toThrow();
    expect(() =>
      assertScheduleApplication(["topic_1"], blocks, {
        ...preferences,
        blackoutDates: ["2026-02-30"],
      }),
    ).toThrow("real date");
    expect(() => assertAutoBlockReplacement([], blocks)).toThrow("outside the reflow scope");
  });

  it("requires a reorder to contain every sibling exactly once", () => {
    expect(() => assertReorderComplete(["a", "b"], ["b", "a"], "Topics")).not.toThrow();
    expect(() => assertReorderComplete(["a", "b"], ["a"], "Topics")).toThrow(
      "every sibling",
    );
    expect(() => assertReorderComplete(["a", "b"], ["a", "a"], "Topics")).toThrow(
      "duplicates",
    );
    expect(() => assertReorderComplete(["a", "b"], ["a", "elsewhere"], "Topics")).toThrow(
      "every sibling",
    );
  });

  it("validates preferences as a complete semantic unit", () => {
    expect(() =>
      assertPreferences({
        dailyCapacityUnits: 50,
        studyDaysOfWeek: [1, 3, 5],
        blackoutDates: ["2026-12-24"],
        accentColor: "#1769e0",
      }),
    ).not.toThrow();
    expect(() =>
      assertPreferences({
        studyDaysOfWeek: [1, 1],
        blackoutDates: [],
        accentColor: "#1769e0",
      }),
    ).toThrow("duplicates");
    expect(() =>
      assertPreferences({
        studyDaysOfWeek: [7],
        blackoutDates: [],
        accentColor: "#1769e0",
      }),
    ).toThrow("cannot exceed 6");
    expect(() =>
      assertPreferences({
        studyDaysOfWeek: [],
        blackoutDates: ["2026-02-30"],
        accentColor: "#1769e0",
      }),
    ).toThrow("real date");
  });
});

describe("planner import guard", () => {
  it("accepts an acyclic document", () => {
    expect(() =>
      assertImportPayload([
        plan([
          topic({ key: "foundations", name: "Foundations" }),
          topic({ key: "advanced", name: "Advanced", dependencies: ["foundations"] }),
        ]),
      ]),
    ).not.toThrow();
  });

  it("allows duplicate display names while requiring safe unique opaque keys", () => {
    expect(() =>
      assertImportPayload([
        plan([
          topic({ key: "first", name: "Same name" }),
          topic({ key: "second", name: "Same name" }),
        ]),
      ]),
    ).not.toThrow();
    expect(() =>
      assertImportPayload([
        plan([topic({ key: "duplicate" }), topic({ key: "duplicate" })]),
      ]),
    ).toThrow("duplicated");
    expect(() => assertImportPayload([plan([topic({ name: "NUL\0name" })])])).toThrow(
      "control characters",
    );
    expect(() => assertImportPayload([plan([topic({ key: "unsafe.key" })])])).toThrow(
      "letters",
    );
  });

  it("rejects missing, duplicate, and cyclic dependency references", () => {
    expect(() => assertImportPayload([plan([topic({ dependencies: ["Missing"] })])])).toThrow(
      "does not reference an imported topic",
    );
    expect(() =>
      assertImportPayload([plan([topic({ dependencies: ["Other", "Other"] })])]),
    ).toThrow("duplicates");
    expect(() =>
      assertImportPayload([
        plan([
          topic({ key: "a", name: "A", dependencies: ["b"] }),
          topic({ key: "b", name: "B", dependencies: ["a"] }),
        ]),
      ]),
    ).toThrow("cannot contain a cycle");
  });

  it("rejects dependencies that cross course boundaries", () => {
    const firstCourse = plan([topic({ key: "first" })]).courses[0];
    const secondCourse = {
      ...firstCourse,
      name: "Second course",
      topics: [topic({ key: "second", dependencies: ["first"] })],
    };
    expect(() =>
      assertImportPayload([
        {
          name: "Semester",
          notes: "",
          courses: [firstCourse, secondCourse],
        },
      ]),
    ).toThrow("same course");
  });

  it("enforces one aggregate record budget", () => {
    const tooManyTopics = Array.from({ length: PLANNER_LIMITS.importEntities }, (_, index) =>
      topic({ key: `topic_${index}`, name: `Topic ${index}` }),
    );
    expect(() => assertImportPayload([plan(tooManyTopics)])).toThrow("records");
  });

  it("validates imported log scalar values", () => {
    expect(() =>
      assertImportPayload([plan()], [
        {
          topicKey: "topic_0",
          date: "2026-08-20",
          units: -25,
          minutes: 30,
        },
      ]),
    ).not.toThrow();
    expect(() =>
      assertImportPayload([plan()], [
        {
          topicKey: "topic_0",
          date: "2026-08-20",
          units: Number.NaN,
        },
      ]),
    ).toThrow("finite");
    expect(() =>
      assertImportPayload([plan()], [
        {
          topicKey: "missing",
          date: "2026-08-20",
          units: 10,
        },
      ]),
    ).toThrow("missing topic key");
  });

  it("enforces aggregate reference and text budgets", () => {
    const foundations = Array.from({ length: 500 }, (_, index) =>
      topic({ key: `base_${index}`, name: `Base ${index}` }),
    );
    const dependents = Array.from({ length: 11 }, (_, index) =>
      topic({
        key: `dependent_${index}`,
        name: `Dependent ${index}`,
        dependencies: foundations.map((item) => item.key),
      }),
    );
    expect(() => assertImportPayload([plan([...foundations, ...dependents])])).toThrow(
      "references",
    );

    const textHeavyPlans = Array.from({ length: PLANNER_LIMITS.importPlans }, (_, index) =>
      plan([], {
        name: `Plan ${index}`,
        notes: "x".repeat(PLANNER_LIMITS.notesCharacters),
        courses: [],
      }),
    );
    expect(() => assertImportPayload(textHeavyPlans)).toThrow("Import text cannot exceed");
  });
});
