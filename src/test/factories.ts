/**
 * Fixture builders for the unit tests.
 *
 * Domain entities have a dozen fields each, most of which are irrelevant to any
 * given assertion. These fill in the boring ones so a test can state only what
 * it is actually about — `topic({ totalUnits: 100, completedUnits: 25 })` reads
 * as the case under test rather than as a wall of defaults.
 *
 * Not under `src/domain` on purpose: nothing shipped should be able to import
 * a fixture by accident.
 */

import type { Course, Exam, Plan, PlannerSnapshot, Topic } from "@/domain/types";
import { DEFAULT_PREFERENCES } from "@/domain/types";

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1)}`;

export function topic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: overrides.id ?? nextId("topic"),
    courseId: "course_1",
    name: "Topic",
    unit: "slides",
    totalUnits: 0,
    completedUnits: 0,
    status: "planned",
    priority: "normal",
    dependencyIds: [],
    color: "violet",
    notes: "",
    order: 0,
    blocks: [],
    ...overrides,
  };
}

export function exam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: overrides.id ?? nextId("exam"),
    courseId: "course_1",
    name: "Exam",
    kind: "exam",
    startDate: "2026-08-01",
    status: "confirmed",
    notes: "",
    order: 0,
    ...overrides,
  };
}

export function course(overrides: Partial<Course> = {}): Course {
  return {
    id: overrides.id ?? nextId("course"),
    planId: "plan_1",
    name: "Course",
    color: "violet",
    notes: "",
    order: 0,
    exams: [],
    topics: [],
    ...overrides,
  };
}

export function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: overrides.id ?? nextId("plan"),
    name: "Semester",
    notes: "",
    courses: [],
    ...overrides,
  };
}

export function snapshot(overrides: Partial<PlannerSnapshot> = {}): PlannerSnapshot {
  return {
    plans: [],
    studyLog: [],
    preferences: DEFAULT_PREFERENCES,
    ...overrides,
  };
}
