/**
 * Convex-backed repository.
 *
 * Deliberately built on `ConvexReactClient.watchQuery` rather than the React
 * hooks, so that everything above `src/data/` is plain TypeScript and can be
 * unit-tested without a renderer. `useRepository` in `src/data/use-repository.ts`
 * is the only place that bridges back into React.
 *
 * The client carries auth state set by `ConvexAuthProvider`; queries issued
 * before sign-in fail server-side with "Not signed in", which surfaces here as
 * the `error` state.
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
import type { PlannerExport } from "@/lib/import-export";
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

function toTopic(topic: PlanTree["courses"][number]["topics"][number]): Topic {
  return {
    id: topic._id,
    courseId: topic.courseId,
    name: topic.name,
    section: topic.section,
    unit: topic.unit,
    totalUnits: topic.totalUnits,
    completedUnits: topic.completedUnits,
    status: topic.status,
    priority: topic.priority,
    dependencyIds: topic.dependencyIds,
    color: topic.color,
    notes: topic.notes,
    order: topic.order,
    blocks: topic.blocks.map(toStudyBlock),
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

function toCourse(course: PlanTree["courses"][number]): Course {
  return {
    id: course._id,
    planId: course.planId,
    name: course.name,
    code: course.code,
    color: course.color,
    notes: course.notes,
    order: course.order,
    exams: course.exams.map(toExam),
    topics: course.topics.map(toTopic),
  };
}

export function toPlan(plan: PlanTree): Plan {
  return {
    id: plan._id,
    name: plan.name,
    notes: plan.notes,
    startDate: plan.startDate,
    endDate: plan.endDate,
    courses: plan.courses.map(toCourse),
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

function toPreferences(row: PreferencesRow): Preferences {
  if (!row) return DEFAULT_PREFERENCES;
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

/* ------------------------------------------------------------- repository */

type Parts = {
  plans?: PlanTree[];
  studyLog?: Doc<"studyLog">[];
  preferences?: PreferencesRow;
  preferencesLoaded?: boolean;
};

export function createConvexRepository(client: ConvexReactClient): PlannerRepository {
  const asId = <T extends "plans" | "courses" | "exams" | "topics" | "studyBlocks">(id: string) =>
    id as Id<T>;

  const subscribe = (listener: (state: RepositoryState) => void) => {
    const parts: Parts = {};
    let failed = false;

    const emit = () => {
      if (failed) return;
      // All three queries must have landed. Emitting a partial snapshot would
      // flash an empty plan list for the instant before `plans` arrives, which
      // is exactly the "you have no plans yet" empty state.
      if (!parts.plans || !parts.studyLog || !parts.preferencesLoaded) return;

      listener({
        status: "ready",
        snapshot: {
          plans: parts.plans.map(toPlan),
          studyLog: parts.studyLog.map(toLogEntry),
          preferences: toPreferences(parts.preferences ?? null),
        } satisfies PlannerSnapshot,
      });
    };

    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
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
      const read = () => {
        try {
          assign(queryWatch.localQueryResult());
          emit();
        } catch (error) {
          fail(error);
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
        startDate: input.startDate,
        endDate: input.endDate,
      });
    },
    async deletePlan(planId) {
      await client.mutation(api.planner.deletePlan, { planId: asId<"plans">(planId) });
    },

    async createCourse(planId, input: CourseInput) {
      return await client.mutation(api.planner.createCourse, {
        planId: asId<"plans">(planId),
        ...input,
      });
    },
    async updateCourse(courseId, input) {
      await client.mutation(api.planner.updateCourse, {
        courseId: asId<"courses">(courseId),
        name: input.name,
        code: input.code,
        notes: input.notes,
        color: input.color,
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
      });
    },
    async createTopics(courseId, topics, color) {
      return await client.mutation(api.planner.createTopics, {
        courseId: asId<"courses">(courseId),
        topics,
        color,
      });
    },
    async updateTopic(topicId, patch: TopicPatch) {
      await client.mutation(api.planner.updateTopic, {
        topicId: asId<"topics">(topicId),
        ...patch,
      });
    },
    async deleteTopic(topicId) {
      await client.mutation(api.planner.deleteTopic, { topicId: asId<"topics">(topicId) });
    },
    async reorderTopics(courseId, topicIds) {
      await client.mutation(api.planner.reorderTopics, {
        courseId: asId<"courses">(courseId),
        topicIds: topicIds.map((id) => asId<"topics">(id)),
      });
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
        blocks: blocks.map((block) => ({ ...block, topicId: asId<"topics">(block.topicId) })),
      });
    },

    async logStudy(input: StudyLogInput) {
      await client.mutation(api.planner.logStudy, {
        ...input,
        topicId: asId<"topics">(input.topicId),
      });
    },

    async savePreferences(preferences) {
      await client.mutation(api.planner.savePreferences, {
        dailyCapacityUnits: preferences.dailyCapacityUnits,
        studyDaysOfWeek: [...preferences.studyDaysOfWeek],
        blackoutDates: [...preferences.blackoutDates],
        theme: preferences.theme,
        accentColor: preferences.accentColor,
      });
    },

    async importPlans(document: PlannerExport) {
      await client.mutation(api.planner.importPlans, { plans: document.plans });
    },
    async replaceAll(document: PlannerExport) {
      await client.mutation(api.planner.replaceAllPlans, {
        plans: document.plans,
        studyLog: document.studyLog,
      });
    },
  };
}
