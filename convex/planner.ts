import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

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

async function requireUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
}

async function assertPlanOwner(ctx: { db: PlannerDb }, planId: Id<"plans">, userId: Id<"users">) {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.ownerId !== userId) {
    // Deliberately indistinguishable from "does not exist", so the API cannot
    // be used to probe for other users' plan ids.
    throw new Error("Plan not found");
  }
  return plan;
}

async function assertCourseOwner(ctx: { db: PlannerDb }, courseId: Id<"courses">, userId: Id<"users">) {
  const course = await ctx.db.get(courseId);
  if (!course) {
    throw new Error("Course not found");
  }
  await assertPlanOwner(ctx, course.planId, userId);
  return course;
}

async function assertTopicOwner(ctx: { db: PlannerDb }, topicId: Id<"topics">, userId: Id<"users">) {
  const topic = await ctx.db.get(topicId);
  if (!topic) {
    throw new Error("Topic not found");
  }
  const course = await assertCourseOwner(ctx, topic.courseId, userId);
  return { topic, course };
}

async function assertExamOwner(ctx: { db: PlannerDb }, examId: Id<"exams">, userId: Id<"users">) {
  const exam = await ctx.db.get(examId);
  if (!exam) {
    throw new Error("Exam not found");
  }
  await assertCourseOwner(ctx, exam.courseId, userId);
  return exam;
}

async function assertBlockOwner(ctx: { db: PlannerDb }, blockId: Id<"studyBlocks">, userId: Id<"users">) {
  const block = await ctx.db.get(blockId);
  if (!block) {
    throw new Error("Study block not found");
  }
  await assertTopicOwner(ctx, block.topicId, userId);
  return block;
}

function assertOrderedDates(startDate: string, endDate?: string) {
  if (endDate && endDate < startDate) {
    throw new Error("End date cannot be before the start date");
  }
}

function assertProgress(completedUnits: number, totalUnits: number) {
  if (completedUnits < 0 || totalUnits < 0) {
    throw new Error("Unit counts cannot be negative");
  }
  if (totalUnits > 0 && completedUnits > totalUnits) {
    throw new Error("Completed units cannot exceed the total");
  }
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const since = args.since;
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("plans", {
      ownerId: userId,
      name: args.name,
      notes: args.notes ?? "",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updatePlan = mutation({
  args: {
    planId: v.id("plans"),
    name: v.string(),
    notes: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    await ctx.db.patch(args.planId, {
      name: args.name,
      notes: args.notes,
      updatedAt: Date.now(),
    });
  },
});

export const deletePlan = mutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    await deletePlanTree(ctx, args.planId);
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    const existing = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", args.planId)).collect();
    const now = Date.now();
    return await ctx.db.insert("courses", {
      planId: args.planId,
      name: args.name,
      code: args.code,
      notes: args.notes ?? "",
      color: args.color,
      order: nextOrder(existing),
      createdAt: now,
      updatedAt: now,
    });
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertCourseOwner(ctx, args.courseId, userId);
    await ctx.db.patch(args.courseId, {
      name: args.name,
      code: args.code,
      notes: args.notes,
      color: args.color,
      updatedAt: Date.now(),
    });
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
    const now = Date.now();

    for (const course of args.courses) {
      await assertCourseOwner(ctx, course.courseId, userId);
      await ctx.db.patch(course.courseId, { color: course.color, updatedAt: now });
    }
    for (const topic of args.topics) {
      await assertTopicOwner(ctx, topic.topicId, userId);
      await ctx.db.patch(topic.topicId, { color: topic.color, updatedAt: now });
    }
    return null;
  },
});

export const deleteCourse = mutation({
  args: { courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertCourseOwner(ctx, args.courseId, userId);
    await deleteCourseTree(ctx, args.courseId);
  },
});

export const reorderCourses = mutation({
  args: { planId: v.id("plans"), courseIds: v.array(v.id("courses")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    const now = Date.now();
    for (const [index, courseId] of args.courseIds.entries()) {
      const course = await assertCourseOwner(ctx, courseId, userId);
      if (course.planId !== args.planId) {
        throw new Error("Course does not belong to that plan");
      }
      await ctx.db.patch(courseId, { order: index, updatedAt: now });
    }
  },
});

export const reorderTopics = mutation({
  args: { courseId: v.id("courses"), topicIds: v.array(v.id("topics")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertCourseOwner(ctx, args.courseId, userId);
    const now = Date.now();
    for (const [index, topicId] of args.topicIds.entries()) {
      const { topic } = await assertTopicOwner(ctx, topicId, userId);
      if (topic.courseId !== args.courseId) {
        throw new Error("Topic does not belong to that course");
      }
      await ctx.db.patch(topicId, { order: index, updatedAt: now });
    }
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertCourseOwner(ctx, args.courseId, userId);
    assertOrderedDates(args.startDate, args.endDate);
    const existing = await ctx.db.query("exams").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const now = Date.now();
    return await ctx.db.insert("exams", {
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertExamOwner(ctx, args.examId, userId);
    assertOrderedDates(args.startDate, args.endDate);
    await ctx.db.patch(args.examId, {
      name: args.name,
      kind: args.kind,
      startDate: args.startDate,
      endDate: args.endDate,
      status: args.status,
      notes: args.notes,
      updatedAt: Date.now(),
    });
  },
});

export const deleteExam = mutation({
  args: { examId: v.id("exams") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertExamOwner(ctx, args.examId, userId);
    await ctx.db.delete(args.examId);
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertCourseOwner(ctx, args.courseId, userId);
    const totalUnits = args.totalUnits ?? 0;
    assertProgress(0, totalUnits);
    const existing = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const now = Date.now();
    return await ctx.db.insert("topics", {
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertCourseOwner(ctx, args.courseId, userId);
    const existing = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const now = Date.now();
    const ids: Id<"topics">[] = [];

    for (const [index, topic] of args.topics.entries()) {
      assertProgress(0, topic.totalUnits);
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertTopicOwner(ctx, args.topicId, userId);
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
  },
});

export const moveTopic = mutation({
  args: { topicId: v.id("topics"), courseId: v.id("courses") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic, course: oldCourse } = await assertTopicOwner(ctx, args.topicId, userId);
    const targetCourse = await assertCourseOwner(ctx, args.courseId, userId);
    if (oldCourse._id === targetCourse._id) return;
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
  },
});

export const deleteTopic = mutation({
  args: { topicId: v.id("topics") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic } = await assertTopicOwner(ctx, args.topicId, userId);
    await deleteTopicTree(ctx, topic);
  },
});

export const updateTopicDependencies = mutation({
  args: { topicId: v.id("topics"), dependencyIds: v.array(v.id("topics")) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic } = await assertTopicOwner(ctx, args.topicId, userId);

    const dependencies = await Promise.all(args.dependencyIds.map((id) => ctx.db.get(id)));
    if (dependencies.some((dependency) => !dependency || dependency.courseId !== topic.courseId)) {
      throw new Error("Dependencies must be topics in the same course");
    }
    if (args.dependencyIds.includes(args.topicId) || (await createsCycle(ctx, args.topicId, args.dependencyIds))) {
      throw new Error("Topic dependencies cannot create a cycle");
    }

    await ctx.db.patch(args.topicId, { dependencyIds: args.dependencyIds, updatedAt: Date.now() });
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertTopicOwner(ctx, args.topicId, userId);
    assertOrderedDates(args.startDate, args.endDate);
    const now = Date.now();
    return await ctx.db.insert("studyBlocks", {
      topicId: args.topicId,
      startDate: args.startDate,
      endDate: args.endDate,
      plannedUnits: args.plannedUnits,
      // Anything created without an explicit source came from a user gesture.
      source: args.source ?? "manual",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStudyBlock = mutation({
  args: {
    blockId: v.id("studyBlocks"),
    startDate: v.string(),
    endDate: v.string(),
    plannedUnits: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const block = await assertBlockOwner(ctx, args.blockId, userId);
    assertOrderedDates(args.startDate, args.endDate);
    await ctx.db.patch(args.blockId, {
      startDate: args.startDate,
      endDate: args.endDate,
      plannedUnits: args.plannedUnits ?? block.plannedUnits,
      // Dragging a generated block adopts it: the next reflow must not undo a
      // placement the user made deliberately.
      source: "manual",
      updatedAt: Date.now(),
    });
  },
});

export const deleteStudyBlock = mutation({
  args: { blockId: v.id("studyBlocks") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertBlockOwner(ctx, args.blockId, userId);
    await ctx.db.delete(args.blockId);
  },
});

/**
 * Replaces the generated schedule for a set of topics.
 *
 * Deletes only `auto` blocks, then inserts the new ones — the whole reason
 * `source` exists. Scoped to explicit topic ids so a course-level reflow cannot
 * reach into another course.
 */
export const replaceAutoBlocks = mutation({
  args: {
    topicIds: v.array(v.id("topics")),
    blocks: v.array(
      v.object({
        topicId: v.id("topics"),
        startDate: v.string(),
        endDate: v.string(),
        plannedUnits: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const allowed = new Set<string>();
    for (const topicId of args.topicIds) {
      await assertTopicOwner(ctx, topicId, userId);
      allowed.add(topicId);
    }
    for (const block of args.blocks) {
      if (!allowed.has(block.topicId)) {
        throw new Error("Cannot write blocks for a topic outside the reflow scope");
      }
      assertOrderedDates(block.startDate, block.endDate);
    }

    for (const topicId of args.topicIds) {
      const existing = await ctx.db
        .query("studyBlocks")
        .withIndex("by_topic", (q) => q.eq("topicId", topicId))
        .collect();
      for (const block of existing) {
        if (block.source === "auto") await ctx.db.delete(block._id);
      }
    }

    const now = Date.now();
    for (const block of args.blocks) {
      await ctx.db.insert("studyBlocks", { ...block, source: "auto", createdAt: now, updatedAt: now });
    }
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
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { topic } = await assertTopicOwner(ctx, args.topicId, userId);
    if (!Number.isFinite(args.units)) {
      throw new Error("Units must be a number");
    }

    const raw = topic.completedUnits + args.units;
    const completedUnits = Math.max(0, topic.totalUnits > 0 ? Math.min(topic.totalUnits, raw) : raw);

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

    return await ctx.db.insert("studyLog", {
      ownerId: userId,
      topicId: args.topicId,
      date: args.date,
      units: args.units,
      minutes: args.minutes,
      note: args.note,
      createdAt: now,
    });
  },
});

/* ------------------------------------------------------------ preferences */

export const savePreferences = mutation({
  args: {
    dailyCapacityUnits: v.optional(v.number()),
    studyDaysOfWeek: v.array(v.number()),
    blackoutDates: v.array(v.string()),
    theme: v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
    accentColor: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db.query("preferences").withIndex("by_owner", (q) => q.eq("ownerId", userId)).unique();
    const patch = { ...args, updatedAt: Date.now() };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("preferences", { ownerId: userId, ...patch });
  },
});

/* ---------------------------------------------------------- import / seed */

const importBlock = v.object({
  startDate: v.string(),
  endDate: v.string(),
  plannedUnits: v.optional(v.number()),
  source: v.optional(blockSourceValidator),
});
const importTopic = v.object({
  name: v.string(),
  unit: unitValidator,
  totalUnits: v.number(),
  completedUnits: v.number(),
  status: statusValidator,
  priority: priorityValidator,
  color: courseColorValidator,
  notes: v.string(),
  /** Dependencies travel as names — ids are not stable across deployments. */
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

/**
 * Log entries reference their topic by course and topic name rather than by id,
 * because ids do not exist until the import has run. Names are unique within a
 * course by construction of the exporter.
 */
const importLogEntry = v.object({
  courseName: v.string(),
  topicName: v.string(),
  date: v.string(),
  units: v.number(),
  minutes: v.optional(v.number()),
  note: v.optional(v.string()),
});

export const importPlans = mutation({
  args: { plans: v.array(importPlan) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { planIds } = await insertPlans(ctx, userId, args.plans);
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
  args: { plans: v.array(importPlan), studyLog: v.optional(v.array(importLogEntry)) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    const existing = await ctx.db.query("plans").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();
    for (const plan of existing) {
      await deletePlanTree(ctx, plan._id);
    }
    const staleLog = await ctx.db.query("studyLog").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();
    for (const entry of staleLog) {
      await ctx.db.delete(entry._id);
    }

    const { planIds, topicIdsByPath } = await insertPlans(ctx, userId, args.plans);

    const now = Date.now();
    for (const entry of args.studyLog ?? []) {
      const topicId = topicIdsByPath.get(`${entry.courseName}\0${entry.topicName}`);
      // Silently skipped rather than thrown: a log entry pointing at a topic
      // that is not in the import is stale data, not a reason to fail the seed.
      if (!topicId) continue;
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

    return planIds;
  },
});

async function insertPlans(ctx: MutationCtx, userId: Id<"users">, plans: ImportPlanInput[]) {
  const now = Date.now();
  const planIds: Id<"plans">[] = [];
  /** Keyed `courseName\0topicName`, for resolving study-log references. */
  const topicIdsByPath = new Map<string, Id<"topics">>();

  for (const planInput of plans) {
    const planId = await ctx.db.insert("plans", {
      ownerId: userId,
      name: planInput.name,
      notes: planInput.notes,
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
        assertOrderedDates(examInput.startDate, examInput.endDate);
        await ctx.db.insert("exams", {
          courseId,
          ...examInput,
          order: examIndex,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Scoped per course: two courses may legitimately both have a topic
      // called "Overview", and a shared map would cross-link them.
      const topicIdsByName = new Map<string, Id<"topics">>();
      const pendingDependencies: Array<{ topicId: Id<"topics">; dependencies: string[] }> = [];

      for (const [topicIndex, topicInput] of courseInput.topics.entries()) {
        assertProgress(topicInput.completedUnits, topicInput.totalUnits);
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

        topicIdsByName.set(topicInput.name, topicId);
        topicIdsByPath.set(`${courseInput.name}\0${topicInput.name}`, topicId);
        pendingDependencies.push({ topicId, dependencies: topicInput.dependencies });

        for (const blockInput of topicInput.blocks) {
          assertOrderedDates(blockInput.startDate, blockInput.endDate);
          await ctx.db.insert("studyBlocks", {
            topicId,
            startDate: blockInput.startDate,
            endDate: blockInput.endDate,
            plannedUnits: blockInput.plannedUnits,
            source: blockInput.source ?? "manual",
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      for (const pending of pendingDependencies) {
        const dependencyIds = pending.dependencies
          .map((name) => topicIdsByName.get(name))
          .filter((id): id is Id<"topics"> => id !== undefined && id !== pending.topicId);
        if (dependencyIds.length > 0) {
          await ctx.db.patch(pending.topicId, { dependencyIds, updatedAt: now });
        }
      }
    }
  }

  return { planIds, topicIdsByPath };
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
