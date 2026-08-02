import { describe, expect, it } from "vitest";
import type { Course, Plan, PlannerSnapshot } from "@/domain";
import { DEFAULT_PREFERENCES } from "@/domain";
import { course as makeCourse, exam as makeExam, plan as makePlan, topic as makeTopic } from "@/test/factories";
import {
  coursesInFocus,
  hasExamSoon,
  healthByCourse,
  isBehind,
  matchesQuery,
  resolveSelection,
  upcomingExams,
} from "./scope";

const TODAY = "2026-05-01";

function snapshotOf(plan: Plan, studyLog: PlannerSnapshot["studyLog"] = []): PlannerSnapshot {
  return { plans: [plan], studyLog, preferences: DEFAULT_PREFERENCES };
}

/** A course that cannot finish: a lot of material, an exam next week, nothing logged. */
function hopeless(name: string): Course {
  return makeCourse({
    name,
    topics: [makeTopic({ name: `${name} everything`, totalUnits: 5000, completedUnits: 0 })],
    exams: [makeExam({ name: `${name} exam`, startDate: "2026-05-08" })],
  });
}

/** A course that is finished. Nothing left to do is on track whatever the velocity. */
function finished(name: string): Course {
  return makeCourse({
    name,
    topics: [makeTopic({ name: `${name} everything`, totalUnits: 10, completedUnits: 10 })],
    exams: [makeExam({ name: `${name} exam`, startDate: "2026-05-08" })],
  });
}

describe("isBehind", () => {
  it("is true when the projection misses the exam", () => {
    const plan = makePlan({ courses: [hopeless("Biochem")] });
    const health = healthByCourse(plan, snapshotOf(plan), TODAY);
    expect(isBehind(health.get(plan.courses[0].id))).toBe(true);
  });

  it("is false for a course with no exam, rather than treating it as late", () => {
    // Without a deadline "behind" has no meaning. Calling such a course behind
    // would put every unscheduled course in the recovery list on day one.
    const plan = makePlan({
      courses: [makeCourse({ topics: [makeTopic({ totalUnits: 5000 })], exams: [] })],
    });
    const health = healthByCourse(plan, snapshotOf(plan), TODAY);
    expect(isBehind(health.get(plan.courses[0].id))).toBe(false);
  });

  it("is false once there is nothing left to do", () => {
    const plan = makePlan({ courses: [finished("Anatomy")] });
    const health = healthByCourse(plan, snapshotOf(plan), TODAY);
    expect(isBehind(health.get(plan.courses[0].id))).toBe(false);
  });
});

describe("hasExamSoon", () => {
  it("counts an exam inside the horizon and not one beyond it", () => {
    const plan = makePlan({
      courses: [
        makeCourse({ name: "Near", exams: [makeExam({ startDate: "2026-05-10" })] }),
        makeCourse({ name: "Far", exams: [makeExam({ startDate: "2026-07-01" })] }),
      ],
    });
    const health = healthByCourse(plan, snapshotOf(plan), TODAY);

    expect(hasExamSoon(health.get(plan.courses[0].id))).toBe(true);
    expect(hasExamSoon(health.get(plan.courses[1].id))).toBe(false);
  });

  it("does not count a course with no exam", () => {
    const plan = makePlan({ courses: [makeCourse({ exams: [] })] });
    const health = healthByCourse(plan, snapshotOf(plan), TODAY);
    expect(hasExamSoon(health.get(plan.courses[0].id))).toBe(false);
  });
});

describe("coursesInFocus", () => {
  const plan = makePlan({
    courses: [
      hopeless("Biochem"),
      finished("Anatomy"),
      makeCourse({ name: "Physio", exams: [makeExam({ startDate: "2026-09-01" })] }),
    ],
  });
  const health = healthByCourse(plan, snapshotOf(plan), TODAY);

  it("returns everything under 'all'", () => {
    expect(coursesInFocus(plan, { kind: "all" }, health)).toHaveLength(3);
  });

  it("narrows to the courses that are actually behind", () => {
    expect(coursesInFocus(plan, { kind: "behind" }, health).map((course) => course.name)).toEqual([
      "Biochem",
    ]);
  });

  it("narrows to the courses with an exam inside the horizon", () => {
    expect(coursesInFocus(plan, { kind: "soon" }, health).map((course) => course.name)).toEqual([
      "Biochem",
      "Anatomy",
    ]);
  });

  it("drops hidden courses", () => {
    const hidden = { hiddenCourseIds: [plan.courses[0].id] };
    expect(coursesInFocus(plan, { kind: "all" }, health, hidden).map((c) => c.name)).toEqual([
      "Anatomy",
      "Physio",
    ]);
  });

  it("returns nothing when there is no plan at all", () => {
    expect(coursesInFocus(undefined, { kind: "all" }, health)).toEqual([]);
  });
});

describe("resolveSelection", () => {
  const topic = makeTopic({ name: "Glycolysis" });
  const exam = makeExam({ name: "Final" });
  const course = makeCourse({ name: "Biochem", topics: [topic], exams: [exam] });
  const plan = makePlan({ courses: [course] });

  it("resolves a course, a topic and an exam, each with its course", () => {
    expect(resolveSelection(plan, { kind: "course", id: course.id })).toEqual({
      kind: "course",
      course,
    });
    expect(resolveSelection(plan, { kind: "topic", id: topic.id })).toEqual({
      kind: "topic",
      course,
      topic,
    });
    expect(resolveSelection(plan, { kind: "exam", id: exam.id })).toEqual({
      kind: "exam",
      course,
      exam,
    });
  });

  it("resolves a deleted id to nothing", () => {
    // The inspector describing whatever now sits at that position, with total
    // confidence, is exactly the failure the fifth product principle rules out.
    expect(resolveSelection(plan, { kind: "topic", id: "gone" })).toBeNull();
  });

  it("does not mistake a topic id for a course id", () => {
    expect(resolveSelection(plan, { kind: "course", id: topic.id })).toBeNull();
  });

  it("is null with no selection and with no plan", () => {
    expect(resolveSelection(plan, null)).toBeNull();
    expect(resolveSelection(undefined, { kind: "course", id: course.id })).toBeNull();
  });
});

describe("upcomingExams", () => {
  it("sorts across courses and drops the ones already past", () => {
    const plan = makePlan({
      courses: [
        makeCourse({ name: "A", exams: [makeExam({ name: "late", startDate: "2026-06-01" })] }),
        makeCourse({ name: "B", exams: [makeExam({ name: "soon", startDate: "2026-05-04" })] }),
        makeCourse({ name: "C", exams: [makeExam({ name: "past", startDate: "2026-04-01" })] }),
      ],
    });

    expect(upcomingExams(plan, TODAY).map((row) => row.exam.name)).toEqual(["soon", "late"]);
  });

  it("includes an exam happening today", () => {
    const plan = makePlan({
      courses: [makeCourse({ exams: [makeExam({ name: "now", startDate: TODAY })] })],
    });
    expect(upcomingExams(plan, TODAY)).toHaveLength(1);
    expect(upcomingExams(plan, TODAY)[0].days).toBe(0);
  });
});

describe("matchesQuery", () => {
  it("matches case-insensitively across the fields it is given", () => {
    expect(matchesQuery("gly", "Glycolysis", undefined)).toBe(true);
    expect(matchesQuery("BLOCK", "Glycolysis", "Block 1")).toBe(true);
  });

  it("matches everything on an empty or whitespace query", () => {
    expect(matchesQuery("", "anything")).toBe(true);
    expect(matchesQuery("   ", "anything")).toBe(true);
  });

  it("does not match on letters that merely appear in order", () => {
    // Substring, not subsequence. "gls" is not a query for "Glycolysis".
    expect(matchesQuery("gls", "Glycolysis")).toBe(false);
  });
});
