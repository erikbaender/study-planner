/**
 * Convex-backed repository.
 *
 * Deliberately built on `ConvexReactClient.watchQuery` rather than the React
 * hooks, so that everything above `src/data/` is plain TypeScript and can be
 * unit-tested without a renderer. `useRepository` in `src/data/use-repository.ts`
 * is the only place that bridges back into React.
 *
 * The client carries auth state set by `ConvexAuthProvider`. Its host does not
 * construct or subscribe this repository until authentication succeeds.
 */

import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  DEFAULT_PREFERENCES,
  type Course,
  type Exam,
  type Plan,
  type PlannerSnapshot,
  type Preferences,
  type StudyBlock,
  type StudyLogEntry,
  type Topic,
  type Weekday,
} from "@/domain/types";
import type { PlannerTransferDocument } from "@/lib/planner-transfer";
import { resolveCourseColorId } from "@/domain/palette";
import type {
  CourseInput,
  ExamInput,
  GeneratedBlock,
  PlannerRepository,
  PlanInput,
  RepositoryState,
  StudyBlockInput,
  StudyLogInput,
  TopicInput,
  TopicPatch,
} from "./repository";

/* ------------------------------------------------------------- translation */

/**
 * Derived from the query rather than hand-written, so that changing what
 * `loadPlanTree` returns is a type error here instead of a runtime surprise.
 */
type PlanTree = FunctionReturnType<typeof api.planner.listPlanTrees>[number];
type PreferencesRow = FunctionReturnType<typeof api.planner.getPreferences>;
type CourseTree = PlanTree["courses"][number];
type TopicTree = CourseTree["topics"][number];

function toStudyBlock(block: Doc<"studyBlocks">): StudyBlock {
  return {
    id: block._id,
    topicId: block.topicId,
    startDate: block.startDate,
    endDate: block.endDate,
    plannedUnits: block.plannedUnits,
    source: block.source,
  };
}

function toTopic(topic: TopicTree, blocks: StudyBlock[]): Topic {
  return {
    id: topic._id,
    courseId: topic.courseId,
    name: topic.name,
    unit: topic.unit,
    totalUnits: topic.totalUnits,
    completedUnits: topic.completedUnits,
    status: topic.status,
    priority: topic.priority,
    dependencyIds: topic.dependencyIds,
    color: resolveCourseColorId(topic.color),
    notes: topic.notes,
    order: topic.order,
    blocks,
  };
}

function toExam(exam: Doc<"exams">): Exam {
  return {
    id: exam._id,
    courseId: exam.courseId,
    name: exam.name,
    kind: exam.kind,
    startDate: exam.startDate,
    endDate: exam.endDate,
    status: exam.status,
    notes: exam.notes,
    order: exam.order,
  };
}

function toCourse(course: CourseTree, exams: Exam[], topics: Topic[]): Course {
  return {
    id: course._id,
    planId: course.planId,
    name: course.name,
    code: course.code,
    color: resolveCourseColorId(course.color),
    notes: course.notes,
    order: course.order,
    exams,
    topics,
  };
}

function toPlan(plan: PlanTree, courses: Course[]): Plan {
  return {
    id: plan._id,
    name: plan.name,
    notes: plan.notes,
    courses,
  };
}

function toLogEntry(entry: Doc<"studyLog">): StudyLogEntry {
  return {
    id: entry._id,
    topicId: entry.topicId,
    date: entry.date,
    units: entry.units,
    minutes: entry.minutes,
    note: entry.note,
  };
}

function toPreferences(row: NonNullable<PreferencesRow>): Preferences {
  return {
    dailyCapacityUnits: row.dailyCapacityUnits,
    // Stored as plain numbers because Convex has no narrower numeric type;
    // anything outside 0–6 is corrupt data and is dropped rather than trusted.
    studyDaysOfWeek: row.studyDaysOfWeek.filter(
      (day): day is Weekday => Number.isInteger(day) && day >= 0 && day <= 6,
    ),
    blackoutDates: row.blackoutDates,
    theme: row.theme,
    accentColor: row.accentColor,
  };
}

/** Memoizes a translated immutable Convex value by its source identity. */
function memoizeSource<Source extends object, Result>(
  translate: (source: Source) => Result,
): (source: Source) => Result {
  const cache = new WeakMap<Source, Result>();

  return (source) => {
    const cached = cache.get(source);
    if (cached !== undefined) return cached;
    const result = translate(source);
    cache.set(source, result);
    return result;
  };
}

function sameItems<Item>(left: readonly Item[], right: readonly Item[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Memoizes a query-result array and also shares it when Convex supplies a new
 * outer array containing the same immutable source objects in the same order.
 */
function memoizeList<Source extends object, Result>(
  translate: (source: Source) => Result,
): (sources: readonly Source[]) => Result[] {
  const cache = new WeakMap<readonly Source[], Result[]>();
  let previous: Result[] | undefined;

  return (sources) => {
    const cached = cache.get(sources);
    if (cached) {
      previous = cached;
      return cached;
    }

    const translated = sources.map(translate);
    const result = previous && sameItems(previous, translated) ? previous : translated;
    cache.set(sources, result);
    previous = result;
    return result;
  };
}

/**
 * Translates immutable Convex query results while preserving unchanged domain
 * branches. Unrelated query updates therefore do not recreate every plan, and
 * a changed parent can still reuse children whose raw source objects survived.
 */
function createSnapshotTranslator() {
  const translateBlock = memoizeSource(toStudyBlock);
  const translateBlocks = memoizeList(translateBlock);
  const translateTopic = memoizeSource((topic: TopicTree) =>
    toTopic(topic, translateBlocks(topic.blocks)),
  );
  const translateTopics = memoizeList(translateTopic);
  const translateExam = memoizeSource(toExam);
  const translateExams = memoizeList(translateExam);
  const translateCourse = memoizeSource((course: CourseTree) =>
    toCourse(course, translateExams(course.exams), translateTopics(course.topics)),
  );
  const translateCourses = memoizeList(translateCourse);
  const translatePlan = memoizeSource((plan: PlanTree) =>
    toPlan(plan, translateCourses(plan.courses)),
  );
  const translatePlans = memoizeList(translatePlan);
  const translateLogEntry = memoizeSource(toLogEntry);
  const translateStudyLog = memoizeList(translateLogEntry);
  const translatePreferences = memoizeSource(toPreferences);
  let previous: PlannerSnapshot | undefined;

  return (
    plans: PlanTree[],
    studyLog: Doc<"studyLog">[],
    preferencesRow: PreferencesRow,
  ): PlannerSnapshot => {
    const translatedPlans = translatePlans(plans);
    const translatedStudyLog = translateStudyLog(studyLog);
    const preferences = preferencesRow
      ? translatePreferences(preferencesRow)
      : DEFAULT_PREFERENCES;

    if (
      previous &&
      previous.plans === translatedPlans &&
      previous.studyLog === translatedStudyLog &&
      previous.preferences === preferences
    ) {
      return previous;
    }

    previous = {
      plans: translatedPlans,
      studyLog: translatedStudyLog,
      preferences,
    };
    return previous;
  };
}

/* ------------------------------------------------------------- repository */

type Parts = {
  plans?: PlanTree[];
  studyLog?: Doc<"studyLog">[];
  preferences?: PreferencesRow;
  preferencesLoaded?: boolean;
};

export function createConvexRepository(client: ConvexReactClient): PlannerRepository {
  const translateSnapshot = createSnapshotTranslator();
  const asId = <T extends "plans" | "courses" | "exams" | "topics" | "studyBlocks">(id: string) =>
    id as Id<T>;
  const scheduleBlocks = (blocks: GeneratedBlock[]) =>
    blocks.map((block) => ({ ...block, topicId: asId<"topics">(block.topicId) }));
  const preferenceArgs = (preferences: Preferences) => ({
    dailyCapacityUnits: preferences.dailyCapacityUnits,
    studyDaysOfWeek: [...preferences.studyDaysOfWeek],
    blackoutDates: [...preferences.blackoutDates],
    theme: preferences.theme,
    accentColor: preferences.accentColor,
  });

  const subscribe = (listener: (state: RepositoryState) => void) => {
    const parts: Parts = {};
    const failedWatches = new Set<symbol>();
    const colorMigrationWatch = Symbol("color migration");
    let colorMigrationRequested = false;

    const emit = () => {
      if (failedWatches.size > 0) return;
      // All three queries must have landed. Emitting a partial snapshot would
      // flash an empty plan list for the instant before `plans` arrives, which
      // is exactly the "you have no plans yet" empty state.
      if (!parts.plans || !parts.studyLog || !parts.preferencesLoaded) return;

      if (!colorMigrationRequested) {
        const courses = parts.plans.flatMap((plan) =>
          plan.courses
            .filter((course) => course.color !== resolveCourseColorId(course.color))
            .map((course) => ({
              courseId: course._id,
              color: resolveCourseColorId(course.color),
            })),
        );
        const topics = parts.plans.flatMap((plan) =>
          plan.courses.flatMap((course) =>
            course.topics
              .filter((topic) => topic.color !== resolveCourseColorId(topic.color))
              .map((topic) => ({
                topicId: topic._id,
                color: resolveCourseColorId(topic.color),
              })),
          ),
        );
        colorMigrationRequested = true;
        if (courses.length > 0 || topics.length > 0) {
          void client
            .mutation(api.planner.migrateColorReferences, { courses, topics })
            .catch((error: unknown) => {
              colorMigrationRequested = false;
              fail(error, colorMigrationWatch);
            });
        }
      }

      listener({
        status: "ready",
        snapshot: translateSnapshot(parts.plans, parts.studyLog, parts.preferences ?? null),
      });
    };

    const fail = (error: unknown, watch: symbol) => {
      failedWatches.add(watch);
      listener({
        status: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    };

    /**
     * `onUpdate` fires on change, but a query already in the client's cache has
     * a value before we ever subscribe — so each watch is also read once
     * eagerly, or a warm cache would leave the app stuck on "loading".
     */
    const watch = <T>(
      queryWatch: { onUpdate(callback: () => void): () => void; localQueryResult(): T | undefined },
      assign: (value: T | undefined) => void,
    ) => {
      const watchId = Symbol("planner query");
      const read = () => {
        try {
          assign(queryWatch.localQueryResult());
          failedWatches.delete(watchId);
          if (!colorMigrationRequested) failedWatches.delete(colorMigrationWatch);
          emit();
        } catch (error) {
          fail(error, watchId);
        }
      };
      const unsubscribe = queryWatch.onUpdate(read);
      read();
      return unsubscribe;
    };

    listener({ status: "loading" });

    const unsubscribers = [
      watch(client.watchQuery(api.planner.listPlanTrees, {}), (value) => {
        parts.plans = value;
      }),
      watch(client.watchQuery(api.planner.listStudyLog, {}), (value) => {
        parts.studyLog = value;
      }),
      watch(client.watchQuery(api.planner.getPreferences, {}), (value) => {
        // `undefined` means "still loading"; `null` means "no row yet", and the
        // query returns `null` for a user who has never saved preferences.
        if (value === undefined) return;
        parts.preferences = value;
        parts.preferencesLoaded = true;
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  };

  return {
    subscribe,

    async createPlan(input: PlanInput) {
      return await client.mutation(api.planner.createPlan, input);
    },
    async updatePlan(planId, input) {
      await client.mutation(api.planner.updatePlan, {
        planId: asId<"plans">(planId),
        name: input.name,
        notes: input.notes ?? "",
      });
    },
    async deletePlan(planId) {
      await client.mutation(api.planner.deletePlan, { planId: asId<"plans">(planId) });
    },

    async createCourse(planId, input: CourseInput) {
      return await client.mutation(api.planner.createCourse, {
        planId: asId<"plans">(planId),
        ...input,
        color: resolveCourseColorId(input.color),
      });
    },
    async updateCourse(courseId, input) {
      await client.mutation(api.planner.updateCourse, {
        courseId: asId<"courses">(courseId),
        name: input.name,
        code: input.code,
        notes: input.notes,
        color: resolveCourseColorId(input.color),
      });
    },
    async deleteCourse(courseId) {
      await client.mutation(api.planner.deleteCourse, { courseId: asId<"courses">(courseId) });
    },
    async reorderCourses(planId, courseIds) {
      await client.mutation(api.planner.reorderCourses, {
        planId: asId<"plans">(planId),
        courseIds: courseIds.map((id) => asId<"courses">(id)),
      });
    },

    async reorderTopics(courseId, topicIds) {
      await client.mutation(api.planner.reorderTopics, {
        courseId: asId<"courses">(courseId),
        topicIds: topicIds.map((id) => asId<"topics">(id)),
      });
    },

    async createExam(courseId, input: ExamInput) {
      return await client.mutation(api.planner.createExam, {
        courseId: asId<"courses">(courseId),
        ...input,
      });
    },
    async updateExam(examId, input) {
      await client.mutation(api.planner.updateExam, {
        examId: asId<"exams">(examId),
        name: input.name,
        kind: input.kind,
        startDate: input.startDate,
        endDate: input.endDate,
        status: input.status,
        notes: input.notes,
      });
    },
    async deleteExam(examId) {
      await client.mutation(api.planner.deleteExam, { examId: asId<"exams">(examId) });
    },

    async createTopic(courseId, input: TopicInput) {
      return await client.mutation(api.planner.createTopic, {
        courseId: asId<"courses">(courseId),
        ...input,
        color: resolveCourseColorId(input.color),
      });
    },
    async createTopics(courseId, topics, color) {
      return await client.mutation(api.planner.createTopics, {
        courseId: asId<"courses">(courseId),
        topics,
        color: resolveCourseColorId(color),
      });
    },
    async updateTopic(topicId, patch: TopicPatch) {
      await client.mutation(api.planner.updateTopic, {
        topicId: asId<"topics">(topicId),
        ...patch,
        color: resolveCourseColorId(patch.color),
      });
    },
    async moveTopic(topicId, courseId) {
      await client.mutation(api.planner.moveTopic, {
        topicId: asId<"topics">(topicId),
        courseId: asId<"courses">(courseId),
      });
    },
    async deleteTopic(topicId) {
      await client.mutation(api.planner.deleteTopic, { topicId: asId<"topics">(topicId) });
    },
    async setTopicDependencies(topicId, dependencyIds) {
      await client.mutation(api.planner.updateTopicDependencies, {
        topicId: asId<"topics">(topicId),
        dependencyIds: dependencyIds.map((id) => asId<"topics">(id)),
      });
    },

    async createStudyBlock(input: StudyBlockInput) {
      return await client.mutation(api.planner.createStudyBlock, {
        ...input,
        topicId: asId<"topics">(input.topicId),
      });
    },
    async updateStudyBlock(blockId, input) {
      await client.mutation(api.planner.updateStudyBlock, {
        blockId: asId<"studyBlocks">(blockId),
        ...input,
      });
    },
    async deleteStudyBlock(blockId) {
      await client.mutation(api.planner.deleteStudyBlock, {
        blockId: asId<"studyBlocks">(blockId),
      });
    },
    async replaceAutoBlocks(topicIds, blocks: GeneratedBlock[]) {
      await client.mutation(api.planner.replaceAutoBlocks, {
        topicIds: topicIds.map((id) => asId<"topics">(id)),
        blocks: scheduleBlocks(blocks),
      });
    },
    async applySchedule(topicIds, blocks, preferences) {
      await client.mutation(api.planner.applySchedule, {
        topicIds: topicIds.map((id) => asId<"topics">(id)),
        blocks: scheduleBlocks(blocks),
        preferences: preferenceArgs(preferences),
      });
    },

    async logStudy(input: StudyLogInput) {
      await client.mutation(api.planner.logStudy, {
        ...input,
        topicId: asId<"topics">(input.topicId),
      });
    },

    async savePreferences(preferences) {
      await client.mutation(api.planner.savePreferences, preferenceArgs(preferences));
    },

    async importPlans(document: PlannerTransferDocument) {
      await client.mutation(api.planner.importPlans, {
        plans: document.plans,
        studyLog: document.studyLog,
      });
    },
    async replaceAll(document: PlannerTransferDocument) {
      await client.mutation(api.planner.replaceAllPlans, {
        plans: document.plans,
        studyLog: document.studyLog,
      });
    },
  };
}
