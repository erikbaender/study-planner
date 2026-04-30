import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type PlannerDb = {
  get(id: Id<"plans">): Promise<Doc<"plans"> | null>;
  get(id: Id<"courses">): Promise<Doc<"courses"> | null>;
  get(id: Id<"milestones">): Promise<Doc<"milestones"> | null>;
  get(id: Id<"topics">): Promise<Doc<"topics"> | null>;
  get(id: Id<"topicRanges">): Promise<Doc<"topicRanges"> | null>;
};

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

async function assertMilestoneOwner(ctx: { db: PlannerDb }, milestoneId: Id<"milestones">, userId: Id<"users">) {
  const milestone = await ctx.db.get(milestoneId);
  if (!milestone) {
    throw new Error("Milestone not found");
  }
  await assertCourseOwner(ctx, milestone.courseId, userId);
  return milestone;
}

async function assertRangeOwner(ctx: { db: PlannerDb }, rangeId: Id<"topicRanges">, userId: Id<"users">) {
  const range = await ctx.db.get(rangeId);
  if (!range) {
    throw new Error("Range not found");
  }
  await assertTopicOwner(ctx, range.topicId, userId);
  return range;
}

export const listPlans = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return await ctx.db.query("plans").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();
  },
});

export const listPlanTrees = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const plans = await ctx.db.query("plans").withIndex("by_owner", (q) => q.eq("ownerId", userId)).collect();

    return await Promise.all(
      plans
        .sort((left, right) => left.createdAt - right.createdAt)
        .map(async (plan) => {
          const courses = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", plan._id)).collect();

          return {
            ...plan,
            courses: await Promise.all(
              courses
                .sort((left, right) => left.order - right.order)
                .map(async (course) => {
                  const milestones = await ctx.db
                    .query("milestones")
                    .withIndex("by_course", (q) => q.eq("courseId", course._id))
                    .collect();
                  const topics = await ctx.db
                    .query("topics")
                    .withIndex("by_course", (q) => q.eq("courseId", course._id))
                    .collect();

                  return {
                    ...course,
                    milestones: milestones.sort((left, right) => left.order - right.order),
                    topics: await Promise.all(
                      topics
                        .sort((left, right) => left.order - right.order)
                        .map(async (topic) => ({
                          ...topic,
                          ranges: await ctx.db
                            .query("topicRanges")
                            .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
                            .collect(),
                        })),
                    ),
                  };
                }),
            ),
          };
        }),
    );
  },
});

export const getPlanTree = query({
  args: { planId: v.id("plans") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const plan = await assertPlanOwner(ctx, args.planId, userId);
    const courses = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", plan._id)).collect();

    return {
      ...plan,
      courses: await Promise.all(
        courses
          .sort((left, right) => left.order - right.order)
          .map(async (course) => {
            const milestones = await ctx.db
              .query("milestones")
              .withIndex("by_course", (q) => q.eq("courseId", course._id))
              .collect();
            const topics = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", course._id)).collect();
            return {
              ...course,
              milestones: milestones.sort((left, right) => left.order - right.order),
              topics: await Promise.all(
                topics
                  .sort((left, right) => left.order - right.order)
                  .map(async (topic) => ({
                    ...topic,
                    ranges: await ctx.db
                      .query("topicRanges")
                      .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
                      .collect(),
                  })),
              ),
            };
          }),
      ),
    };
  },
});

export const createPlan = mutation({
  args: { name: v.string(), notes: v.optional(v.string()) },
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
  args: { planId: v.id("plans"), name: v.string(), notes: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    await ctx.db.patch(args.planId, { name: args.name, notes: args.notes, updatedAt: Date.now() });
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

export const createCourse = mutation({
  args: { planId: v.id("plans"), name: v.string(), notes: v.optional(v.string()), color: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertPlanOwner(ctx, args.planId, userId);
    const existing = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", args.planId)).collect();
    const now = Date.now();
    return await ctx.db.insert("courses", {
      planId: args.planId,
      name: args.name,
      notes: args.notes ?? "",
      color: args.color,
      order: existing.length,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateCourse = mutation({
  args: { courseId: v.id("courses"), name: v.string(), notes: v.string(), color: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertCourseOwner(ctx, args.courseId, userId);
    await ctx.db.patch(args.courseId, { name: args.name, notes: args.notes, color: args.color, updatedAt: Date.now() });
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

export const createMilestone = mutation({
  args: {
    courseId: v.id("courses"),
    name: v.string(),
    notes: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.endDate && args.endDate < args.startDate) {
      throw new Error("Milestone end date cannot be before the start date");
    }
    const userId = await requireUser(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) {
      throw new Error("Course not found");
    }
    await assertPlanOwner(ctx, course.planId, userId);
    const existing = await ctx.db.query("milestones").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const now = Date.now();
    return await ctx.db.insert("milestones", { ...args, notes: args.notes ?? "", order: existing.length, createdAt: now, updatedAt: now });
  },
});

export const updateMilestone = mutation({
  args: {
    milestoneId: v.id("milestones"),
    name: v.string(),
    notes: v.string(),
    startDate: v.string(),
    endDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.endDate && args.endDate < args.startDate) {
      throw new Error("Milestone end date cannot be before the start date");
    }
    const userId = await requireUser(ctx);
    await assertMilestoneOwner(ctx, args.milestoneId, userId);
    await ctx.db.patch(args.milestoneId, {
      name: args.name,
      notes: args.notes,
      startDate: args.startDate,
      endDate: args.endDate,
      updatedAt: Date.now(),
    });
  },
});

export const deleteMilestone = mutation({
  args: { milestoneId: v.id("milestones") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertMilestoneOwner(ctx, args.milestoneId, userId);
    await ctx.db.delete(args.milestoneId);
  },
});

export const createTopic = mutation({
  args: { courseId: v.id("courses"), name: v.string(), notes: v.optional(v.string()), color: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const course = await ctx.db.get(args.courseId);
    if (!course) {
      throw new Error("Course not found");
    }
    await assertPlanOwner(ctx, course.planId, userId);
    const existing = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", args.courseId)).collect();
    const now = Date.now();
    return await ctx.db.insert("topics", {
      courseId: args.courseId,
      name: args.name,
      notes: args.notes ?? "",
      color: args.color,
      dependencyIds: [],
      order: existing.length,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTopic = mutation({
  args: { topicId: v.id("topics"), name: v.string(), notes: v.string(), color: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertTopicOwner(ctx, args.topicId, userId);
    await ctx.db.patch(args.topicId, { name: args.name, notes: args.notes, color: args.color, updatedAt: Date.now() });
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
    const topic = await ctx.db.get(args.topicId);
    if (!topic) {
      throw new Error("Topic not found");
    }
    const course = await ctx.db.get(topic.courseId);
    if (!course) {
      throw new Error("Course not found");
    }
    await assertPlanOwner(ctx, course.planId, userId);
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

export const createTopicRange = mutation({
  args: { topicId: v.id("topics"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    if (args.endDate < args.startDate) {
      throw new Error("Range end date cannot be before the start date");
    }
    const userId = await requireUser(ctx);
    const topic = await ctx.db.get(args.topicId);
    if (!topic) {
      throw new Error("Topic not found");
    }
    const course = await ctx.db.get(topic.courseId);
    if (!course) {
      throw new Error("Course not found");
    }
    await assertPlanOwner(ctx, course.planId, userId);
    const now = Date.now();
    return await ctx.db.insert("topicRanges", { ...args, createdAt: now, updatedAt: now });
  },
});

export const updateTopicRange = mutation({
  args: { rangeId: v.id("topicRanges"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    if (args.endDate < args.startDate) {
      throw new Error("Range end date cannot be before the start date");
    }
    const userId = await requireUser(ctx);
    const range = await ctx.db.get(args.rangeId);
    if (!range) {
      throw new Error("Range not found");
    }
    const topic = await ctx.db.get(range.topicId);
    if (!topic) {
      throw new Error("Topic not found");
    }
    const course = await ctx.db.get(topic.courseId);
    if (!course) {
      throw new Error("Course not found");
    }
    await assertPlanOwner(ctx, course.planId, userId);
    await ctx.db.patch(args.rangeId, { startDate: args.startDate, endDate: args.endDate, updatedAt: Date.now() });
  },
});

export const deleteTopicRange = mutation({
  args: { rangeId: v.id("topicRanges") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await assertRangeOwner(ctx, args.rangeId, userId);
    await ctx.db.delete(args.rangeId);
  },
});

const importRange = v.object({ start: v.string(), end: v.string() });
const importTopic = v.object({
  name: v.string(),
  notes: v.string(),
  color: v.string(),
  dependencies: v.array(v.string()),
  ranges: v.array(importRange),
});
const importMilestone = v.object({
  name: v.string(),
  notes: v.string(),
  start: v.string(),
  end: v.optional(v.string()),
});
const importCourse = v.object({
  name: v.string(),
  notes: v.string(),
  color: v.string(),
  milestones: v.array(importMilestone),
  topics: v.array(importTopic),
});
const importPlan = v.object({
  name: v.string(),
  notes: v.string(),
  courses: v.array(importCourse),
});

export const importPlanTrees = mutation({
  args: { plans: v.array(importPlan) },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const planIds: Id<"plans">[] = [];

    for (const planInput of args.plans) {
      const planId = await ctx.db.insert("plans", {
        ownerId: userId,
        name: planInput.name,
        notes: planInput.notes,
        createdAt: now,
        updatedAt: now,
      });
      planIds.push(planId);

      for (let courseIndex = 0; courseIndex < planInput.courses.length; courseIndex += 1) {
        const courseInput = planInput.courses[courseIndex];
        const courseId = await ctx.db.insert("courses", {
          planId,
          name: courseInput.name,
          notes: courseInput.notes,
          color: courseInput.color,
          order: courseIndex,
          createdAt: now,
          updatedAt: now,
        });
        const topicIdsByName = new Map<string, Id<"topics">>();
        const pendingDependencies: Array<{ topicId: Id<"topics">; dependencies: string[] }> = [];

        for (let milestoneIndex = 0; milestoneIndex < courseInput.milestones.length; milestoneIndex += 1) {
          const milestoneInput = courseInput.milestones[milestoneIndex];
          if (milestoneInput.end && milestoneInput.end < milestoneInput.start) {
            throw new Error("Milestone end date cannot be before the start date");
          }
          await ctx.db.insert("milestones", {
            courseId,
            name: milestoneInput.name,
            notes: milestoneInput.notes,
            startDate: milestoneInput.start,
            endDate: milestoneInput.end,
            order: milestoneIndex,
            createdAt: now,
            updatedAt: now,
          });
        }

        for (let topicIndex = 0; topicIndex < courseInput.topics.length; topicIndex += 1) {
          const topicInput = courseInput.topics[topicIndex];
          const topicId = await ctx.db.insert("topics", {
            courseId,
            name: topicInput.name,
            notes: topicInput.notes,
            color: topicInput.color,
            dependencyIds: [],
            order: topicIndex,
            createdAt: now,
            updatedAt: now,
          });
          topicIdsByName.set(topicInput.name, topicId);
          pendingDependencies.push({ topicId, dependencies: topicInput.dependencies });

          for (const rangeInput of topicInput.ranges) {
            if (rangeInput.end < rangeInput.start) {
              throw new Error("Range end date cannot be before the start date");
            }
            await ctx.db.insert("topicRanges", {
              topicId,
              startDate: rangeInput.start,
              endDate: rangeInput.end,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        for (const pending of pendingDependencies) {
          const dependencyIds = pending.dependencies
            .map((dependency) => topicIdsByName.get(dependency))
            .filter((dependencyId): dependencyId is Id<"topics"> => dependencyId !== undefined);
          if (dependencyIds.length > 0) {
            await ctx.db.patch(pending.topicId, { dependencyIds, updatedAt: now });
          }
        }
      }
    }

    return planIds;
  },
});

async function deletePlanTree(ctx: MutationCtx, planId: Id<"plans">) {
  const courses = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", planId)).collect();
  for (const course of courses) {
    await deleteCourseTree(ctx, course._id);
  }
  await ctx.db.delete(planId);
}

async function deleteCourseTree(ctx: MutationCtx, courseId: Id<"courses">) {
  const milestones = await ctx.db.query("milestones").withIndex("by_course", (q) => q.eq("courseId", courseId)).collect();
  const topics = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", courseId)).collect();

  for (const milestone of milestones) {
    await ctx.db.delete(milestone._id);
  }
  for (const topic of topics) {
    await deleteTopicTree(ctx, topic);
  }
  await ctx.db.delete(courseId);
}

async function deleteTopicTree(ctx: MutationCtx, topic: Doc<"topics">) {
  const ranges = await ctx.db.query("topicRanges").withIndex("by_topic", (q) => q.eq("topicId", topic._id)).collect();
  const siblingTopics = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", topic.courseId)).collect();

  for (const range of ranges) {
    await ctx.db.delete(range._id);
  }
  for (const sibling of siblingTopics) {
    if (sibling._id !== topic._id && sibling.dependencyIds.includes(topic._id)) {
      await ctx.db.patch(sibling._id, {
        dependencyIds: sibling.dependencyIds.filter((dependencyId) => dependencyId !== topic._id),
        updatedAt: Date.now(),
      });
    }
  }
  await ctx.db.delete(topic._id);
}

async function createsCycle(ctx: { db: PlannerDb }, topicId: Id<"topics">, dependencyIds: Id<"topics">[]) {
  const visited = new Set<string>();
  const stack = [...dependencyIds];

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    if (currentId === topicId) {
      return true;
    }
    visited.add(currentId);
    const current = await ctx.db.get(currentId);
    if (current) {
      stack.push(...current.dependencyIds);
    }
  }

  return false;
}