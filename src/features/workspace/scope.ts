/**
 * Turning ids into things.
 *
 * Two jobs, both pure so they can be tested without a DOM:
 *
 * - **Focus** decides which courses are in scope. The smart focuses are
 *   questions asked of live metrics, not saved groups, so a course leaves
 *   "Behind" the moment it stops being behind.
 * - **Selection** turns the stored id back into an entity, and returns `null`
 *   when it cannot. A selected topic that has since been deleted must resolve to
 *   nothing rather than to whatever now sits at that position — the inspector
 *   describing the wrong topic with total confidence is exactly the failure the
 *   fifth product principle exists to prevent.
 */

import {
  assessCourse,
  daysUntil,
  effectiveDeadline,
  type Course,
  type CourseHealth,
  type Exam,
  type Plan,
  type PlannerSnapshot,
  type Topic,
} from "@/domain";
import type { Focus, Selection } from "./store";

/** How near an exam has to be to count as "soon". Two weeks is the horizon at which cramming decisions get made. */
export const EXAM_SOON_DAYS = 14;

export function healthByCourse(
  plan: Plan | undefined,
  snapshot: PlannerSnapshot,
  today: string,
): Map<string, CourseHealth> {
  const entries = (plan?.courses ?? []).map((course) => [
    course.id,
    assessCourse({
      course,
      today,
      calendar: snapshot.preferences,
      log: snapshot.studyLog,
      dailyCapacityUnits: snapshot.preferences.dailyCapacityUnits,
    }),
  ]);
  return new Map(entries as Array<[string, CourseHealth]>);
}

export function isBehind(health: CourseHealth | undefined): boolean {
  // `pace` is null when the course has no upcoming exam. Without a deadline
  // "behind" has no meaning, so such a course is not behind — it is unscheduled.
  return health?.pace ? !health.pace.onTrack : false;
}

export function hasExamSoon(health: CourseHealth | undefined, within = EXAM_SOON_DAYS): boolean {
  return health?.daysUntilExam !== null && health?.daysUntilExam !== undefined
    ? health.daysUntilExam <= within
    : false;
}

/** What the sidebar's two switches have been set to. */
export type Visibility = {
  hiddenCourseIds: readonly string[];
};

/**
 * The shared display order for course lists.
 *
 * `Course.order` preserves import and creation order, but it is not a useful
 * navigation order. Keep the source arrays untouched and sort a copy wherever
 * courses are presented to the user instead.
 */
export function sortCoursesAlphabetically(courses: readonly Course[]): Course[] {
  return [...courses].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * The courses every view draws, in one place.
 *
 * Focus first narrows to a question about the plan, then hidden courses are
 * removed from the result.
 */
export function coursesInFocus(
  plan: Plan | undefined,
  focus: Focus,
  health: Map<string, CourseHealth>,
  visibility: Visibility = { hiddenCourseIds: [] },
): Course[] {
  const courses = plan?.courses ?? [];

  const matching =
    focus.kind === "all"
      ? courses
      : focus.kind === "behind"
        ? courses.filter((course) => isBehind(health.get(course.id)))
        : courses.filter((course) => hasExamSoon(health.get(course.id)));

  return sortCoursesAlphabetically(
    matching.filter((course) => !visibility.hiddenCourseIds.includes(course.id)),
  );
}

/**
 * The selection, resolved against the current snapshot.
 *
 * Every variant carries its `course`, because nothing in this app is
 * meaningful without knowing which course it belongs to — the inspector needs
 * it for the breadcrumb, and topic edits need its colour.
 */
export type ResolvedSelection =
  | { kind: "course"; course: Course }
  | { kind: "topic"; course: Course; topic: Topic }
  | { kind: "exam"; course: Course; exam: Exam }
  | null;

export function resolveSelection(plan: Plan | undefined, selection: Selection): ResolvedSelection {
  if (!plan || !selection) return null;

  for (const course of plan.courses) {
    if (selection.kind === "course" && course.id === selection.id) {
      return { kind: "course", course };
    }
    if (selection.kind === "topic") {
      const topic = course.topics.find((candidate) => candidate.id === selection.id);
      if (topic) return { kind: "topic", course, topic };
    }
    if (selection.kind === "exam") {
      const exam = course.exams.find((candidate) => candidate.id === selection.id);
      if (exam) return { kind: "exam", course, exam };
    }
  }

  return null;
}

/** Sorted soonest-first, across every course in the plan. Drives the Today view and the sidebar counts. */
export function upcomingExams(
  plan: Plan | undefined,
  today: string,
): Array<{ course: Course; exam: Exam; days: number }> {
  const rows = (plan?.courses ?? []).flatMap((course) =>
    course.exams
      .filter((exam) => effectiveDeadline(exam) >= today)
      .map((exam) => ({ course, exam, days: daysUntil(effectiveDeadline(exam), today) })),
  );
  return rows.sort((left, right) => left.days - right.days);
}

/**
 * Case-insensitive substring match over the fields someone would actually type.
 *
 * Deliberately not fuzzy: this filters a list the user is already looking at,
 * and a fuzzy match that keeps rows they cannot see the reason for reads as a
 * broken filter. The command palette ranks differently — see `commands.ts`.
 */
export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}
