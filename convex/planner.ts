import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { recordBrowserMutation } from "./plannerApplication";
import {
  assertAutoBlockReplacement,
  assertBoundedArray,
  assertBoundedText,
  assertDistinctBoundedArray,
  assertFiniteBoundedNumber,
  assertImportPayload,
  assertIsoDate,
  assertOrderedIsoDates,
  assertPlannedUnits,
  assertPreferences,
  assertProgress,
  assertReorderComplete,
  assertScheduleApplication,
  assertTrimmedBoundedText,
  PLANNER_LIMITS,
} from "./plannerGuards";

/**
 * Server-side planner API.
 *
 * The ownership chain below is the security boundary. `src/domain/validation.ts`
 * duplicates the *shape* rules so the client can fail fast, but nothing here
 * trusts it — every mutation re-derives the caller's ownership from the plan
 * that ultimately contains the row being touched.
 */

type PlannerDb = {
  get(id: Id<"plans">): Promise<Doc<"plans"> | null>;
  get(id: Id<"courses">): Promise<Doc<"courses"> | null>;
  get(id: Id<"exams">): Promise<Doc<"exams"> | null>;
  get(id: Id<"topics">): Promise<Doc<"topics"> | null>;
  get(id: Id<"studyBlocks">): Promise<Doc<"studyBlocks"> | null>;
};

const unitValidator = v.union(
  v.literal("slides"),
  v.literal("pages"),
  v.literal("cards"),
  v.literal("videos"),
  v.literal("hours"),
  v.literal("items"),
);
const statusValidator = v.union(v.literal("planned"), v.literal("active"), v.literal("done"));
const priorityValidator = v.union(v.literal("low"), v.literal("normal"), v.literal("high"));
const examKindValidator = v.union(
  v.literal("exam"),
  v.literal("deadline"),
  v.literal("presentation"),
  v.literal("other"),
);
const examStatusValidator = v.union(v.literal("confirmed"), v.literal("provisional"));
const blockSourceValidator = v.union(v.literal("auto"), v.literal("manual"));
const courseColorValidator = v.union(
  v.literal("coral"),
  v.literal("tangerine"),
  v.literal("gold"),
  v.literal("lime"),
  v.literal("chartreuse"),
  v.literal("jade"),
  v.literal("turquoise"),
  v.literal("violet"),
  v.literal("orchid"),
  v.literal("rose"),
);

const planDocumentFields = {
  _id: v.id("plans"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  name: v.string(),
  notes: v.string(),
  revision: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
};
const courseDocumentFields = {
  _id: v.id("courses"),
  _creationTime: v.number(),
  planId: v.id("plans"),
  name: v.string(),
  code: v.optional(v.string()),
  notes: v.string(),
  color: v.string(),
  order: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
const examDocumentValidator = v.object({
  _id: v.id("exams"),
  _creationTime: v.number(),
  courseId: v.id("courses"),
  name: v.string(),
  kind: examKindValidator,
  startDate: v.string(),
  endDate: v.optional(v.string()),
  status: examStatusValidator,
  notes: v.string(),
  order: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
const topicDocumentFields = {
  _id: v.id("topics"),
  _creationTime: v.number(),
  courseId: v.id("courses"),
  name: v.string(),
  section: v.optional(v.string()),
  unit: unitValidator,
  totalUnits: v.number(),
  completedUnits: v.number(),
  status: statusValidator,
  priority: priorityValidator,
  dependencyIds: v.array(v.id("topics")),
  color: v.string(),
  notes: v.string(),
  order: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
};
const studyBlockDocumentValidator = v.object({
  _id: v.id("studyBlocks"),
  _creationTime: v.number(),
  topicId: v.id("topics"),
  startDate: v.string(),
  endDate: v.string(),
  plannedUnits: v.optional(v.number()),
  source: blockSourceValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});
const studyLogDocumentValidator = v.object({
  _id: v.id("studyLog"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  topicId: v.id("topics"),
  date: v.string(),
  units: v.number(),
  minutes: v.optional(v.number()),
  note: v.optional(v.string()),
  createdAt: v.number(),
});
const preferencesDocumentValidator = v.object({
  _id: v.id("preferences"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  dailyCapacityUnits: v.optional(v.number()),
  studyDaysOfWeek: v.array(v.number()),
  blackoutDates: v.array(v.string()),
  theme: v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
  accentColor: v.string(),
  updatedAt: v.number(),
});
const planTreeValidator = v.object({
  ...planDocumentFields,
  courses: v.array(
    v.object({
      ...courseDocumentFields,
      exams: v.array(examDocumentValidator),
      topics: v.array(
        v.object({
          ...topicDocumentFields,
          blocks: v.array(studyBlockDocumentValidator),
        }),
      ),
    }),
  ),
});

async function requireUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
}

async function assertPlanOwner(
  ctx: { db: PlannerDb },
  planId: Id<"plans">,
  userId: Id<"users">,
  notFoundMessage = "Plan not found",
) {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.ownerId !== userId) {
    // Deliberately indistinguishable from "does not exist", so the API cannot
    // be used to probe for other users' plan ids.
    throw new Error(notFoundMessage);
  }
  return plan;
}

async function assertCourseOwner(
  ctx: { db: PlannerDb },
  courseId: Id<"courses">,
  userId: Id<"users">,
  notFoundMessage = "Course not found",
) {
  const course = await ctx.db.get(courseId);
  if (!course) {
    throw new Error(notFoundMessage);
  }
  await assertPlanOwner(ctx, course.planId, userId, notFoundMessage);
  return course;
}

async function assertTopicOwner(
  ctx: { db: PlannerDb },
  topicId: Id<"topics">,
  userId: Id<"users">,
  notFoundMessage = "Topic not found",
) {
  const topic = await ctx.db.get(topicId);
  if (!topic) {
    throw new Error(notFoundMessage);
  }
  const course = await assertCourseOwner(ctx, topic.courseId, userId, notFoundMessage);
  return { topic, course };
}

async function assertExamOwner(ctx: { db: PlannerDb }, examId: Id<"exams">, userId: Id<"users">) {
  const exam = await ctx.db.get(examId);
  if (!exam) {
    throw new Error("Exam not found");
  }
  await assertCourseOwner(ctx, exam.courseId, userId, "Exam not found");
  return exam;
}

async function assertBlockOwner(ctx: { db: PlannerDb }, blockId: Id<"studyBlocks">, userId: Id<"users">) {
  const block = await ctx.db.get(blockId);
  if (!block) {
    throw new Error("Study block not found");
  }
  await assertTopicOwner(ctx, block.topicId, userId, "Study block not found");
  return block;
}

/**
 * The next free sort key among siblings.
 *
 * `siblings.length` would be wrong after a delete: with orders 0, 1, 2 and the
 * middle one removed, the next insert would land on 2 and tie with an existing
 * row, making the sort order depend on `Array.prototype.sort` stability.
 */
function nextOrder(siblings: Array<{ order: number }>) {
  return siblings.reduce((highest, sibling) => Math.max(highest, sibling.order + 1), 0);
}

/* ---------------------------------------------------------------- queries */

export const listPlanTrees = query({
  args: {},
  returns: v.array(planTreeValidator),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const plans = await ctx.db.query("plans").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();

    return await Promise.all(
      plans.sort((left, right) => left.createdAt - right.createdAt).map((plan) => loadPlanTree(ctx, plan)),
    );
  },
});

export const listStudyLog = query({
  args: { since: v.optional(v.string()) },
  returns: v.array(studyLogDocumentValidator),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const since = args.since;
    if (since !== undefined) assertIsoDate(since, "Since date");
    const entries = since
      ? await ctx.db
          .query("studyLog")
          .withIndex("by_owner_and_date", (q) => q.eq("ownerId", userId).gte("date", since))
          .collect()
      : await ctx.db.query("studyLog").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();

    return entries.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
  },
});

export const getPreferences = query({
  args: {},
  returns: v.union(v.null(), preferencesDocumentValidator),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db.query("preferences").withIndex("by_owner", (q) => q.eq("ownerId", userId)).unique();
  },
});

/**
 * Loads a full plan tree. Still N+1 across courses and topics, but every step
 * is index-backed and the whole tree is what the UI subscribes to; splitting it
 * would trade one round trip for many reactive subscriptions.
 */
async function loadPlanTree(ctx: { db: QueryCtx["db"] }, plan: Doc<"plans">) {
  const courses = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", plan._id)).collect();

  return {
    ...plan,
    courses: await Promise.all(
      courses
        .sort((left, right) => left.order - right.order)
        .map(async (course) => {
          const exams = await ctx.db
            .query("exams")
            .withIndex("by_course", (q) => q.eq("courseId", course._id))
            .collect();
          const topics = await ctx.db
            .query("topics")
            .withIndex("by_course", (q) => q.eq("courseId", course._id))
            .collect();

          return {
            ...course,
            exams: exams.sort((left, right) => left.order - right.order),
            topics: await Promise.all(
              topics
                .sort((left, right) => left.order - right.order)
                .map(async (topic) => ({
                  ...topic,
                  blocks: await ctx.db
                    .query("studyBlocks")
                    .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
                    .collect(),
                })),
            ),
          };
        }),
    ),
  };
}

/* ------------------------------------------------------------------ plans */

export const createPlan = mutation({
  args: {
    name: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.id("plans"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    assertTrimmedBoundedText(args.name, "Plan name", PLANNER_LIMITS.nameCharacters);
    assertBoundedText(args.notes ?? "", "Plan notes", PLANNER_LIMITS.notesCharacters);
    const now = Date.now();
    const planId = await ctx.db.insert("plans", {
      ownerId: userId,
      name: args.name,
      notes: args.notes ?? "",
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId,
      summary: `Created plan ${args.name}`,
      affectedEntityIds: [planId],
    });
    return planId;
  },
});

export const updatePlan = mutation({
  args: {
    planId: v.id("plans"),
    name: v.string(),
    notes: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    assertTrimmedBoundedText(args.name, "Plan name", PLANNER_LIMITS.nameCharacters);
    assertBoundedText(args.notes, "Plan notes", PLANNER_LIMITS.notesCharacters);
    await ctx.db.patch(args.planId, {
      name: args.name,
      notes: args.notes,
      updatedAt: Date.now(),
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: args.planId,
      summary: "Updated plan details",
      affectedEntityIds: [args.planId],
    });
    return null;
  },
});

export const deletePlan = mutation({
  args: { planId: v.id("plans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: args.planId,
      summary: "Deleted plan",
      affectedEntityIds: [args.planId],
    });
    await deletePlanTree(ctx, args.planId);
    return null;
  },
});

/* ---------------------------------------------------------------- courses */

export const createCourse = mutation({
  args: {
    planId: v.id("plans"),
    name: v.string(),
    code: v.optional(v.string()),
    notes: v.optional(v.string()),
    color: courseColorValidator,
  },
  returns: v.id("courses"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    assertTrimmedBoundedText(args.name, "Course name", PLANNER_LIMITS.nameCharacters);
    if (args.code !== undefined) {
      assertTrimmedBoundedText(args.code, "Course code", PLANNER_LIMITS.codeCharacters);
    }
    assertBoundedText(args.notes ?? "", "Course notes", PLANNER_LIMITS.notesCharacters);
    const existing = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", args.planId)).collect();
    const now = Date.now();
    const courseId = await ctx.db.insert("courses", {
      planId: args.planId,
      name: args.name,
      code: args.code,
      notes: args.notes ?? "",
      color: args.color,
      order: nextOrder(existing),
      createdAt: now,
      updatedAt: now,
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: args.planId,
      summary: `Created course ${args.name}`,
      affectedEntityIds: [courseId],
    });
    return courseId;
  },
});

export const updateCourse = mutation({
  args: {
    courseId: v.id("courses"),
    name: v.string(),
    code: v.optional(v.string()),
    notes: v.string(),
    color: courseColorValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const course = await assertCourseOwner(ctx, args.courseId, userId);
    assertTrimmedBoundedText(args.name, "Course name", PLANNER_LIMITS.nameCharacters);
    if (args.code !== undefined) {
      assertTrimmedBoundedText(args.code, "Course code", PLANNER_LIMITS.codeCharacters);
    }
    assertBoundedText(args.notes, "Course notes", PLANNER_LIMITS.notesCharacters);
    await ctx.db.patch(args.courseId, {
      name: args.name,
      code: args.code,
      notes: args.notes,
      color: args.color,
      updatedAt: Date.now(),
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Updated course ${course.name}`,
      affectedEntityIds: [args.courseId],
    });
    return null;
  },
});

/** Rewrites pre-palette hex values after an authenticated client has resolved them. */
export const migrateColorReferences = mutation({
  args: {
    courses: v.array(
      v.object({ courseId: v.id("courses"), color: courseColorValidator }),
    ),
    topics: v.array(v.object({ topicId: v.id("topics"), color: courseColorValidator })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    assertDistinctBoundedArray(
      args.courses,
      "Course color references",
      PLANNER_LIMITS.colorReferences,
      (course) => course.courseId,
    );
    assertDistinctBoundedArray(
      args.topics,
      "Topic color references",
      PLANNER_LIMITS.colorReferences,
      (topic) => topic.topicId,
    );
    const now = Date.now();
    const affectedByPlan = new Map<Id<"plans">, string[]>();

    for (const course of args.courses) {
      const existing = await assertCourseOwner(ctx, course.courseId, userId);
      await ctx.db.patch(course.courseId, { color: course.color, updatedAt: now });
      affectedByPlan.set(existing.planId, [...(affectedByPlan.get(existing.planId) ?? []), course.courseId]);
    }
    for (const topic of args.topics) {
      const { course } = await assertTopicOwner(ctx, topic.topicId, userId);
      await ctx.db.patch(topic.topicId, { color: topic.color, updatedAt: now });
      affectedByPlan.set(course.planId, [...(affectedByPlan.get(course.planId) ?? []), topic.topicId]);
    }
    for (const [planId, affectedEntityIds] of affectedByPlan) {
      await recordBrowserMutation(ctx, {
        ownerId: userId,
        planId,
        summary: "Migrated palette references",
        affectedEntityIds,
      });
    }
    return null;
  },
});

export const deleteCourse = mutation({
  args: { courseId: v.id("courses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const course = await assertCourseOwner(ctx, args.courseId, userId);
    await deleteCourseTree(ctx, args.courseId);
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Deleted course ${course.name}`,
      affectedEntityIds: [args.courseId],
    });
    return null;
  },
});

export const reorderCourses = mutation({
  args: { planId: v.id("plans"), courseIds: v.array(v.id("courses")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    const existing = await ctx.db
      .query("courses")
      .withIndex("by_plan", (q) => q.eq("planId", args.planId))
      .collect();
    assertReorderComplete(
      existing.map((course) => course._id),
      args.courseIds,
      "Course ids",
    );
    const now = Date.now();
    for (const [index, courseId] of args.courseIds.entries()) {
      await ctx.db.patch(courseId, { order: index, updatedAt: now });
    }
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: args.planId,
      summary: "Reordered courses",
      affectedEntityIds: args.courseIds,
    });
    return null;
  },
});

export const reorderTopics = mutation({
  args: { courseId: v.id("courses"), topicIds: v.array(v.id("topics")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const course = await assertCourseOwner(ctx, args.courseId, userId);
    const existing = await ctx.db
      .query("topics")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .collect();
    assertReorderComplete(
      existing.map((topic) => topic._id),
      args.topicIds,
      "Topic ids",
    );
    const now = Date.now();
    for (const [index, topicId] of args.topicIds.entries()) {
      await ctx.db.patch(topicId, { order: index, updatedAt: now });
    }
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: "Reordered topics",
      affectedEntityIds: args.topicIds,
    });
    return null;
  },
});

/* ------------------------------------------------------------------ exams */

export const createExam = mutation({
  args: {
    courseId: v.id("courses"),
    name: v.string(),
    kind: v.optional(examKindValidator),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: v.optional(examStatusValidator),
    notes: v.optional(v.string()),
  },
  returns: v.id("exams"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const course = await assertCourseOwner(ctx, args.courseId, userId);
    assertTrimmedBoundedText(args.name, "Exam name", PLANNER_LIMITS.nameCharacters);
    assertBoundedText(args.notes ?? "", "Exam notes", PLANNER_LIMITS.notesCharacters);
    assertOrderedIsoDates(args.startDate, args.endDate);
    const existing = await ctx.db.query("exams").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const now = Date.now();
    const examId = await ctx.db.insert("exams", {
      courseId: args.courseId,
      name: args.name,
      kind: args.kind ?? "exam",
      startDate: args.startDate,
      endDate: args.endDate,
      // An end date without an explicit status means a window was given, which
      // is exactly what "provisional" describes.
      status: args.status ?? (args.endDate ? "provisional" : "confirmed"),
      notes: args.notes ?? "",
      order: nextOrder(existing),
      createdAt: now,
      updatedAt: now,
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Created exam ${args.name}`,
      affectedEntityIds: [examId],
    });
    return examId;
  },
});

export const updateExam = mutation({
  args: {
    examId: v.id("exams"),
    name: v.string(),
    kind: examKindValidator,
    startDate: v.string(),
    endDate: v.optional(v.string()),
    status: examStatusValidator,
    notes: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const exam = await assertExamOwner(ctx, args.examId, userId);
    const course = await ctx.db.get(exam.courseId);
    if (!course) throw new Error("Exam not found");
    assertTrimmedBoundedText(args.name, "Exam name", PLANNER_LIMITS.nameCharacters);
    assertBoundedText(args.notes, "Exam notes", PLANNER_LIMITS.notesCharacters);
    assertOrderedIsoDates(args.startDate, args.endDate);
    await ctx.db.patch(args.examId, {
      name: args.name,
      kind: args.kind,
      startDate: args.startDate,
      endDate: args.endDate,
      status: args.status,
      notes: args.notes,
      updatedAt: Date.now(),
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Updated exam ${exam.name}`,
      affectedEntityIds: [args.examId],
    });
    return null;
  },
});

export const deleteExam = mutation({
  args: { examId: v.id("exams") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const exam = await assertExamOwner(ctx, args.examId, userId);
    const course = await ctx.db.get(exam.courseId);
    if (!course) throw new Error("Exam not found");
    await ctx.db.delete(args.examId);
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Deleted exam ${exam.name}`,
      affectedEntityIds: [args.examId],
    });
    return null;
  },
});

/* ----------------------------------------------------------------- topics */

export const createTopic = mutation({
  args: {
    courseId: v.id("courses"),
    name: v.string(),
    unit: v.optional(unitValidator),
    totalUnits: v.optional(v.number()),
    priority: v.optional(priorityValidator),
    notes: v.optional(v.string()),
    color: courseColorValidator,
  },
  returns: v.id("topics"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const course = await assertCourseOwner(ctx, args.courseId, userId);
    assertTrimmedBoundedText(args.name, "Topic name", PLANNER_LIMITS.nameCharacters);
    assertBoundedText(args.notes ?? "", "Topic notes", PLANNER_LIMITS.notesCharacters);
    const totalUnits = args.totalUnits ?? 0;
    assertProgress(0, totalUnits);
    const existing = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const now = Date.now();
    const topicId = await ctx.db.insert("topics", {
      courseId: args.courseId,
      name: args.name,
      unit: args.unit ?? "slides",
      totalUnits,
      completedUnits: 0,
      status: "planned",
      priority: args.priority ?? "normal",
      dependencyIds: [],
      color: args.color,
      notes: args.notes ?? "",
      order: nextOrder(existing),
      createdAt: now,
      updatedAt: now,
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Created topic ${args.name}`,
      affectedEntityIds: [topicId],
    });
    return topicId;
  },
});

/** Bulk creation for the outline paste flow — one round trip for a whole course. */
export const createTopics = mutation({
  args: {
    courseId: v.id("courses"),
    topics: v.array(
      v.object({
        name: v.string(),
        unit: unitValidator,
        totalUnits: v.number(),
      }),
    ),
    color: courseColorValidator,
  },
  returns: v.array(v.id("topics")),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const course = await assertCourseOwner(ctx, args.courseId, userId);
    assertBoundedArray(args.topics, "Topics", PLANNER_LIMITS.bulkTopics);
    for (const topic of args.topics) {
      assertTrimmedBoundedText(topic.name, "Topic name", PLANNER_LIMITS.nameCharacters);
      assertProgress(0, topic.totalUnits);
    }
    const existing = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const now = Date.now();
    const ids: Id<"topics">[] = [];

    for (const [index, topic] of args.topics.entries()) {
      ids.push(
        await ctx.db.insert("topics", {
          courseId: args.courseId,
          name: topic.name,
          unit: topic.unit,
          totalUnits: topic.totalUnits,
          completedUnits: 0,
          status: "planned",
          priority: "normal",
          dependencyIds: [],
          color: args.color,
          notes: "",
          order: nextOrder(existing) + index,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Created ${ids.length} topics`,
      affectedEntityIds: ids,
    });
    return ids;
  },
});

export const updateTopic = mutation({
  args: {
    topicId: v.id("topics"),
    name: v.string(),
    unit: unitValidator,
    totalUnits: v.number(),
    completedUnits: v.number(),
    status: statusValidator,
    priority: priorityValidator,
    notes: v.string(),
    color: courseColorValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic, course } = await assertTopicOwner(ctx, args.topicId, userId);
    assertTrimmedBoundedText(args.name, "Topic name", PLANNER_LIMITS.nameCharacters);
    assertBoundedText(args.notes, "Topic notes", PLANNER_LIMITS.notesCharacters);
    assertProgress(args.completedUnits, args.totalUnits);
    await ctx.db.patch(args.topicId, {
      name: args.name,
      unit: args.unit,
      totalUnits: args.totalUnits,
      completedUnits: args.completedUnits,
      status: args.status,
      priority: args.priority,
      notes: args.notes,
      color: args.color,
      updatedAt: Date.now(),
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Updated topic ${topic.name}`,
      affectedEntityIds: [args.topicId],
    });
    return null;
  },
});

export const moveTopic = mutation({
  args: { topicId: v.id("topics"), courseId: v.id("courses") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic, course: oldCourse } = await assertTopicOwner(ctx, args.topicId, userId);
    const targetCourse = await assertCourseOwner(ctx, args.courseId, userId);
    if (oldCourse._id === targetCourse._id) return null;
    if (oldCourse.planId !== targetCourse.planId) {
      throw new Error("A topic can only move within its plan");
    }

    const targetTopics = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const inheritedColor = topic.color === oldCourse.color;
    await ctx.db.patch(args.topicId, {
      courseId: args.courseId,
      order: nextOrder(targetTopics),
      dependencyIds: [],
      // Topic colours normally inherit their course. Preserve an explicit
      // override, while an inherited tint should remain meaningful after the move.
      color: inheritedColor ? targetCourse.color : topic.color,
      updatedAt: Date.now(),
    });

    const oldSiblings = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", oldCourse._id)).collect();
    for (const sibling of oldSiblings) {
      if (sibling.dependencyIds.includes(args.topicId)) {
        await ctx.db.patch(sibling._id, {
          dependencyIds: sibling.dependencyIds.filter((id) => id !== args.topicId),
          updatedAt: Date.now(),
        });
      }
    }
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: targetCourse.planId,
      summary: `Moved topic ${topic.name}`,
      affectedEntityIds: [args.topicId],
    });
    return null;
  },
});

export const deleteTopic = mutation({
  args: { topicId: v.id("topics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic, course } = await assertTopicOwner(ctx, args.topicId, userId);
    await deleteTopicTree(ctx, topic);
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Deleted topic ${topic.name}`,
      affectedEntityIds: [args.topicId],
    });
    return null;
  },
});

export const updateTopicDependencies = mutation({
  args: { topicId: v.id("topics"), dependencyIds: v.array(v.id("topics")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic, course } = await assertTopicOwner(ctx, args.topicId, userId);
    assertDistinctBoundedArray(
      args.dependencyIds,
      "Dependency ids",
      PLANNER_LIMITS.dependencyIds,
    );

    const dependencies = await Promise.all(args.dependencyIds.map((id) => ctx.db.get(id)));
    if (dependencies.some((dependency) => !dependency || dependency.courseId !== topic.courseId)) {
      throw new Error("Dependencies must be topics in the same course");
    }
    if (args.dependencyIds.includes(args.topicId) || (await createsCycle(ctx, args.topicId, args.dependencyIds))) {
      throw new Error("Topic dependencies cannot create a cycle");
    }

    await ctx.db.patch(args.topicId, { dependencyIds: args.dependencyIds, updatedAt: Date.now() });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Updated dependencies for ${topic.name}`,
      affectedEntityIds: [args.topicId],
    });
    return null;
  },
});

/* ----------------------------------------------------------- study blocks */

export const createStudyBlock = mutation({
  args: {
    topicId: v.id("topics"),
    startDate: v.string(),
    endDate: v.string(),
    plannedUnits: v.optional(v.number()),
    source: v.optional(blockSourceValidator),
  },
  returns: v.id("studyBlocks"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { course } = await assertTopicOwner(ctx, args.topicId, userId);
    assertOrderedIsoDates(args.startDate, args.endDate);
    assertPlannedUnits(args.plannedUnits);
    const now = Date.now();
    const blockId = await ctx.db.insert("studyBlocks", {
      topicId: args.topicId,
      startDate: args.startDate,
      endDate: args.endDate,
      plannedUnits: args.plannedUnits,
      // Anything created without an explicit source came from a user gesture.
      source: args.source ?? "manual",
      createdAt: now,
      updatedAt: now,
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: "Created a study block",
      affectedEntityIds: [blockId],
    });
    return blockId;
  },
});

export const updateStudyBlock = mutation({
  args: {
    blockId: v.id("studyBlocks"),
    startDate: v.string(),
    endDate: v.string(),
    plannedUnits: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const block = await assertBlockOwner(ctx, args.blockId, userId);
    const topic = await ctx.db.get(block.topicId);
    const course = topic ? await ctx.db.get(topic.courseId) : null;
    if (!topic || !course) throw new Error("Study block not found");
    assertOrderedIsoDates(args.startDate, args.endDate);
    assertPlannedUnits(args.plannedUnits);
    await ctx.db.patch(args.blockId, {
      startDate: args.startDate,
      endDate: args.endDate,
      plannedUnits: args.plannedUnits ?? block.plannedUnits,
      // Dragging a generated block adopts it: the next reflow must not undo a
      // placement the user made deliberately.
      source: "manual",
      updatedAt: Date.now(),
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: "Moved or resized a study block",
      affectedEntityIds: [args.blockId],
    });
    return null;
  },
});

/** Atomic path for a multi-selection timeline drag/resize. */
export const updateStudyBlocks = mutation({
  args: {
    updates: v.array(
      v.object({
        blockId: v.id("studyBlocks"),
        startDate: v.string(),
        endDate: v.string(),
        plannedUnits: v.optional(v.number()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    assertDistinctBoundedArray(args.updates, "Study block updates", 100, (update) => update.blockId);
    if (args.updates.length === 0) throw new Error("At least one study block update is required");
    const validated: Array<{ block: Doc<"studyBlocks">; planId: Id<"plans">; update: (typeof args.updates)[number] }> = [];
    for (const update of args.updates) {
      const block = await assertBlockOwner(ctx, update.blockId, userId);
      const topic = await ctx.db.get(block.topicId);
      const course = topic ? await ctx.db.get(topic.courseId) : null;
      if (!topic || !course) throw new Error("Study block not found");
      assertOrderedIsoDates(update.startDate, update.endDate);
      assertPlannedUnits(update.plannedUnits);
      validated.push({ block, planId: course.planId, update });
    }
    const planId = validated[0]!.planId;
    if (validated.some((entry) => entry.planId !== planId)) {
      throw new Error("One atomic block update cannot span plans");
    }
    const now = Date.now();
    for (const { block, update } of validated) {
      await ctx.db.patch(block._id, {
        startDate: update.startDate,
        endDate: update.endDate,
        plannedUnits: update.plannedUnits ?? block.plannedUnits,
        source: "manual",
        updatedAt: now,
      });
    }
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId,
      summary: `Moved or resized ${validated.length} study blocks`,
      affectedEntityIds: validated.map((entry) => entry.block._id),
    });
    return null;
  },
});

export const deleteStudyBlock = mutation({
  args: { blockId: v.id("studyBlocks") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const block = await assertBlockOwner(ctx, args.blockId, userId);
    const topic = await ctx.db.get(block.topicId);
    const course = topic ? await ctx.db.get(topic.courseId) : null;
    if (!topic || !course) throw new Error("Study block not found");
    await ctx.db.delete(args.blockId);
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: "Deleted a study block",
      affectedEntityIds: [args.blockId],
    });
    return null;
  },
});

/**
 * Replaces the generated schedule for a set of topics.
 *
 * Deletes only `auto` blocks, then inserts the new ones — the whole reason
 * `source` exists. Scoped to explicit topic ids so a course-level reflow cannot
 * reach into another course.
 */
const generatedBlockValidator = v.object({
  topicId: v.id("topics"),
  startDate: v.string(),
  endDate: v.string(),
  plannedUnits: v.optional(v.number()),
});
type GeneratedBlockInput = (typeof generatedBlockValidator)["type"];

const preferenceFields = {
  dailyCapacityUnits: v.optional(v.number()),
  studyDaysOfWeek: v.array(v.number()),
  blackoutDates: v.array(v.string()),
  theme: v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
  accentColor: v.string(),
};
const preferenceValidator = v.object(preferenceFields);
type PreferenceInput = (typeof preferenceValidator)["type"];

async function assertScheduleTopicOwnership(
  ctx: MutationCtx,
  userId: Id<"users">,
  topicIds: Id<"topics">[],
): Promise<Id<"plans">[]> {
  const planIds = new Set<Id<"plans">>();
  for (const topicId of topicIds) {
    const { course } = await assertTopicOwner(ctx, topicId, userId);
    planIds.add(course.planId);
  }
  return [...planIds];
}

async function writeAutoBlockReplacement(
  ctx: MutationCtx,
  topicIds: Id<"topics">[],
  blocks: GeneratedBlockInput[],
): Promise<void> {
  const existingAutoBlocks: Doc<"studyBlocks">[] = [];
  for (const topicId of topicIds) {
    const existing = await ctx.db
      .query("studyBlocks")
      .withIndex("by_topic_and_source", (q) =>
        q.eq("topicId", topicId).eq("source", "auto"),
      )
      .take(PLANNER_LIMITS.reflowBlocks + 1);
    existingAutoBlocks.push(...existing);
    if (existingAutoBlocks.length > PLANNER_LIMITS.reflowBlocks) {
      throw new Error("Existing generated schedule exceeds the replacement limit");
    }
  }
  for (const block of existingAutoBlocks) {
    await ctx.db.delete(block._id);
  }

  const now = Date.now();
  for (const block of blocks) {
    await ctx.db.insert("studyBlocks", {
      ...block,
      source: "auto",
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function writePreferences(
  ctx: MutationCtx,
  userId: Id<"users">,
  preferences: PreferenceInput,
): Promise<Id<"preferences">> {
  const existing = await ctx.db
    .query("preferences")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .unique();
  const patch = { ...preferences, updatedAt: Date.now() };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("preferences", { ownerId: userId, ...patch });
}

export const replaceAutoBlocks = mutation({
  args: {
    topicIds: v.array(v.id("topics")),
    blocks: v.array(generatedBlockValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    assertAutoBlockReplacement(args.topicIds, args.blocks);
    const planIds = await assertScheduleTopicOwnership(ctx, userId, args.topicIds);
    await writeAutoBlockReplacement(ctx, args.topicIds, args.blocks);
    for (const planId of planIds) {
      await recordBrowserMutation(ctx, {
        ownerId: userId,
        planId,
        summary: "Regenerated study schedule",
        affectedEntityIds: args.topicIds,
      });
    }
    return null;
  },
});

/** Applies generated blocks and the preferences used to calculate them atomically. */
export const applySchedule = mutation({
  args: {
    topicIds: v.array(v.id("topics")),
    blocks: v.array(generatedBlockValidator),
    preferences: preferenceValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    assertScheduleApplication(args.topicIds, args.blocks, args.preferences);
    const planIds = await assertScheduleTopicOwnership(ctx, userId, args.topicIds);

    // Convex mutations are transactions: a failure in either writer rolls
    // back both branches. All input is validated before the first write.
    await writeAutoBlockReplacement(ctx, args.topicIds, args.blocks);
    await writePreferences(ctx, userId, args.preferences);
    for (const planId of planIds) {
      await recordBrowserMutation(ctx, {
        ownerId: userId,
        planId,
        summary: "Applied a regenerated study schedule",
        affectedEntityIds: args.topicIds,
      });
    }
    return null;
  },
});

/* -------------------------------------------------------------- study log */

/**
 * Records units studied and advances the topic's completion in one step.
 *
 * Keeping the two together means the log and the topic can never disagree,
 * which they would if the UI had to remember to write both.
 */
export const logStudy = mutation({
  args: {
    topicId: v.id("topics"),
    date: v.string(),
    units: v.number(),
    minutes: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.id("studyLog"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic, course } = await assertTopicOwner(ctx, args.topicId, userId);
    assertIsoDate(args.date, "Study date");
    assertFiniteBoundedNumber(args.units, "Units", {
      min: -PLANNER_LIMITS.units,
      max: PLANNER_LIMITS.units,
    });
    if (args.minutes !== undefined) {
      assertFiniteBoundedNumber(args.minutes, "Minutes", {
        min: 0,
        max: PLANNER_LIMITS.minutes,
      });
    }
    if (args.note !== undefined) {
      assertBoundedText(args.note, "Study note", PLANNER_LIMITS.logNoteCharacters);
    }

    const raw = topic.completedUnits + args.units;
    const completedUnits = Math.max(0, topic.totalUnits > 0 ? Math.min(topic.totalUnits, raw) : raw);
    // Each log increment is bounded, but repeated increments on an untracked
    // topic (`totalUnits === 0`) can still exceed the persisted/export limit.
    // Reject before either write so progress and its log remain atomic.
    assertProgress(completedUnits, topic.totalUnits);

    const now = Date.now();
    await ctx.db.patch(args.topicId, {
      completedUnits,
      status:
        topic.totalUnits > 0 && completedUnits >= topic.totalUnits
          ? "done"
          : completedUnits > 0
            ? "active"
            : "planned",
      updatedAt: now,
    });

    const logId = await ctx.db.insert("studyLog", {
      ownerId: userId,
      topicId: args.topicId,
      date: args.date,
      units: args.units,
      minutes: args.minutes,
      note: args.note,
      createdAt: now,
    });
    await recordBrowserMutation(ctx, {
      ownerId: userId,
      planId: course.planId,
      summary: `Recorded progress for ${topic.name}`,
      affectedEntityIds: [args.topicId, logId],
    });
    return logId;
  },
});

/* ------------------------------------------------------------ preferences */

export const savePreferences = mutation({
  args: preferenceFields,
  returns: v.id("preferences"),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    assertPreferences(args);
    const preferenceId = await writePreferences(ctx, userId, args);
    const plans = await ctx.db
      .query("plans")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .take(50);
    for (const plan of plans) {
      await recordBrowserMutation(ctx, {
        ownerId: userId,
        planId: plan._id,
        summary: "Updated scheduling preferences",
        affectedEntityIds: [preferenceId],
      });
    }
    return preferenceId;
  },
});

/* ---------------------------------------------------------- import / seed */

const importBlock = v.object({
  startDate: v.string(),
  endDate: v.string(),
  plannedUnits: v.optional(v.number()),
  source: blockSourceValidator,
});
const importTopic = v.object({
  key: v.string(),
  name: v.string(),
  unit: unitValidator,
  totalUnits: v.number(),
  completedUnits: v.number(),
  status: statusValidator,
  priority: priorityValidator,
  color: courseColorValidator,
  notes: v.string(),
  /** Dependencies travel as document-local keys — database ids are not portable. */
  dependencies: v.array(v.string()),
  blocks: v.array(importBlock),
});
const importExam = v.object({
  name: v.string(),
  kind: examKindValidator,
  startDate: v.string(),
  endDate: v.optional(v.string()),
  status: examStatusValidator,
  notes: v.string(),
});
const importCourse = v.object({
  name: v.string(),
  code: v.optional(v.string()),
  color: courseColorValidator,
  notes: v.string(),
  exams: v.array(importExam),
  topics: v.array(importTopic),
});
const importPlan = v.object({
  name: v.string(),
  notes: v.string(),
  courses: v.array(importCourse),
});

type ImportPlanInput = (typeof importPlan)["type"];

const importLogEntry = v.object({
  topicKey: v.string(),
  date: v.string(),
  units: v.number(),
  minutes: v.optional(v.number()),
  note: v.optional(v.string()),
});
type ImportLogInput = (typeof importLogEntry)["type"];

export const importPlans = mutation({
  args: { plans: v.array(importPlan), studyLog: v.array(importLogEntry) },
  returns: v.array(v.id("plans")),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    assertImportPayload(args.plans, args.studyLog);
    const { planIds, topicIdsByKey } = await insertPlans(ctx, userId, args.plans);
    await insertImportedLog(ctx, userId, args.studyLog, topicIdsByKey);
    for (const planId of planIds) {
      await recordBrowserMutation(ctx, {
        ownerId: userId,
        planId,
        summary: "Imported plan",
        affectedEntityIds: [planId],
      });
    }
    return planIds;
  },
});

/**
 * Wipes the caller's plans and replaces them with the supplied ones.
 *
 * Backs the "reset to sample data" development command. Scoped to the caller:
 * it queries `by_owner` and cascades from there, so it cannot reach another
 * user's data even by mistake.
 */
export const replaceAllPlans = mutation({
  args: { plans: v.array(importPlan), studyLog: v.array(importLogEntry) },
  returns: v.array(v.id("plans")),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    assertImportPayload(args.plans, args.studyLog);

    const existing = await ctx.db.query("plans").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();
    for (const plan of existing) {
      await deletePlanTree(ctx, plan._id);
    }
    const staleLog = await ctx.db.query("studyLog").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();
    for (const entry of staleLog) {
      await ctx.db.delete(entry._id);
    }

    const { planIds, topicIdsByKey } = await insertPlans(ctx, userId, args.plans);
    await insertImportedLog(ctx, userId, args.studyLog, topicIdsByKey);

    for (const planId of planIds) {
      await recordBrowserMutation(ctx, {
        ownerId: userId,
        planId,
        summary: "Replaced planner data from the web app",
        affectedEntityIds: [planId],
      });
    }

    return planIds;
  },
});

async function insertPlans(ctx: MutationCtx, userId: Id<"users">, plans: ImportPlanInput[]) {
  const now = Date.now();
  const planIds: Id<"plans">[] = [];
  const topicIdsByKey = new Map<string, Id<"topics">>();

  for (const planInput of plans) {
    const planId = await ctx.db.insert("plans", {
      ownerId: userId,
      name: planInput.name,
      notes: planInput.notes,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    planIds.push(planId);

    for (const [courseIndex, courseInput] of planInput.courses.entries()) {
      const courseId = await ctx.db.insert("courses", {
        planId,
        name: courseInput.name,
        code: courseInput.code,
        notes: courseInput.notes,
        color: courseInput.color,
        order: courseIndex,
        createdAt: now,
        updatedAt: now,
      });

      for (const [examIndex, examInput] of courseInput.exams.entries()) {
        await ctx.db.insert("exams", {
          courseId,
          ...examInput,
          order: examIndex,
          createdAt: now,
          updatedAt: now,
        });
      }

      const topicIdsByKeyInCourse = new Map<string, Id<"topics">>();
      const pendingDependencies: Array<{ topicId: Id<"topics">; dependencies: string[] }> = [];

      for (const [topicIndex, topicInput] of courseInput.topics.entries()) {
        const topicId = await ctx.db.insert("topics", {
          courseId,
          name: topicInput.name,
          unit: topicInput.unit,
          totalUnits: topicInput.totalUnits,
          completedUnits: topicInput.completedUnits,
          status: topicInput.status,
          priority: topicInput.priority,
          dependencyIds: [],
          color: topicInput.color,
          notes: topicInput.notes,
          order: topicIndex,
          createdAt: now,
          updatedAt: now,
        });

        topicIdsByKeyInCourse.set(topicInput.key, topicId);
        topicIdsByKey.set(topicInput.key, topicId);
        pendingDependencies.push({ topicId, dependencies: topicInput.dependencies });

        for (const blockInput of topicInput.blocks) {
          await ctx.db.insert("studyBlocks", {
            topicId,
            startDate: blockInput.startDate,
            endDate: blockInput.endDate,
            plannedUnits: blockInput.plannedUnits,
            source: blockInput.source,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      for (const pending of pendingDependencies) {
        const dependencyIds = pending.dependencies.map((key) => {
          const dependencyId = topicIdsByKeyInCourse.get(key);
          if (!dependencyId) {
            // `assertImportPayload` runs before insertion. Keep this defensive
            // branch so a future internal caller cannot silently lose an edge.
            throw new Error(`Validated dependency ${key} is missing`);
          }
          return dependencyId;
        });
        if (dependencyIds.length > 0) {
          await ctx.db.patch(pending.topicId, { dependencyIds, updatedAt: now });
        }
      }
    }
  }

  return { planIds, topicIdsByKey };
}

async function insertImportedLog(
  ctx: MutationCtx,
  userId: Id<"users">,
  studyLog: ImportLogInput[],
  topicIdsByKey: ReadonlyMap<string, Id<"topics">>,
) {
  const now = Date.now();
  for (const entry of studyLog) {
    const topicId = topicIdsByKey.get(entry.topicKey);
    if (!topicId) {
      throw new Error(`Validated log topic ${entry.topicKey} is missing`);
    }
    await ctx.db.insert("studyLog", {
      ownerId: userId,
      topicId,
      date: entry.date,
      units: entry.units,
      minutes: entry.minutes,
      note: entry.note,
      createdAt: now,
    });
  }
}

/* ------------------------------------------------------ cascade utilities */

async function deletePlanTree(ctx: MutationCtx, planId: Id<"plans">) {
  const courses = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", planId)).collect();
  for (const course of courses) {
    await deleteCourseTree(ctx, course._id);
  }
  await ctx.db.delete(planId);
}

async function deleteCourseTree(ctx: MutationCtx, courseId: Id<"courses">) {
  const exams = await ctx.db.query("exams").withIndex("by_course", (q) => q.eq("courseId", courseId)).collect();
  const topics = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", courseId)).collect();

  for (const exam of exams) {
    await ctx.db.delete(exam._id);
  }
  for (const topic of topics) {
    await deleteTopicTree(ctx, topic);
  }
  await ctx.db.delete(courseId);
}

/**
 * Deletes a topic with its blocks and log entries, and strips it from any
 * sibling that depended on it — otherwise the survivors keep a dangling
 * dependency id that no longer resolves.
 */
async function deleteTopicTree(ctx: MutationCtx, topic: Doc<"topics">) {
  const blocks = await ctx.db.query("studyBlocks").withIndex("by_topic", (q) => q.eq("topicId", topic._id)).collect();
  const logEntries = await ctx.db.query("studyLog").withIndex("by_topic", (q) => q.eq("topicId", topic._id)).collect();
  const siblings = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", topic.courseId)).collect();

  for (const block of blocks) {
    await ctx.db.delete(block._id);
  }
  for (const entry of logEntries) {
    await ctx.db.delete(entry._id);
  }
  for (const sibling of siblings) {
    if (sibling._id !== topic._id && sibling.dependencyIds.includes(topic._id)) {
      await ctx.db.patch(sibling._id, {
        dependencyIds: sibling.dependencyIds.filter((id) => id !== topic._id),
        updatedAt: Date.now(),
      });
    }
  }
  await ctx.db.delete(topic._id);
}

/**
 * Iterative depth-first search over existing edges. Iterative so a long
 * dependency chain cannot exhaust the stack.
 */
async function createsCycle(ctx: { db: PlannerDb }, topicId: Id<"topics">, dependencyIds: Id<"topics">[]) {
  const visited = new Set<string>();
  const stack = [...dependencyIds];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId)) continue;
    if (currentId === topicId) return true;
    visited.add(currentId);
    const current = await ctx.db.get(currentId);
    if (current) stack.push(...current.dependencyIds);
  }

  return false;
}
