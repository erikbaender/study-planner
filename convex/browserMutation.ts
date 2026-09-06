import { getAuthUserId } from "@convex-dev/auth/server";
import { v, type ObjectType, type PropertyValidators, type Validator } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { planRevision, requireOwnedPlan, revisionConflictMessage } from "./plannerApplication";

/** Revision checks happen before the existing operation, in its transaction. */
export async function checkBrowserRevisions(
  ctx: MutationCtx,
  input: Record<string, unknown>,
  expected: Record<string, number> | undefined,
) {
  const ownerId = await getAuthUserId(ctx);
  if (!ownerId) throw new Error("Authentication required");
  const planIds = new Set<Id<"plans">>();
  async function target(field: string, value: unknown): Promise<void> {
    if (typeof value !== "string") return;
    if (field === "planId") { planIds.add(value as Id<"plans">); return; }
    if (field === "courseId") {
      const course = await ctx.db.get(value as Id<"courses">);
      if (!course) throw new Error("Course not found");
      planIds.add(course.planId);
    } else if (field === "topicId") {
      const topic = await ctx.db.get(value as Id<"topics">);
      if (!topic) throw new Error("Topic not found");
      await target("courseId", topic.courseId);
    } else if (field === "examId") {
      const exam = await ctx.db.get(value as Id<"exams">);
      if (!exam) throw new Error("Exam not found");
      await target("courseId", exam.courseId);
    } else if (field === "blockId") {
      const block = await ctx.db.get(value as Id<"studyBlocks">);
      if (!block) throw new Error("Study block not found");
      await target("topicId", block.topicId);
    }
  }
  for (const [field, value] of Object.entries(input)) {
    await target(field, value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") await target(field.replace(/Ids$/, "Id"), item);
        else if (item && typeof item === "object") {
          for (const [key, id] of Object.entries(item)) await target(key, id);
        }
      }
    }
  }
  // Preferences and replacement are account-wide, including applySchedule.
  if (planIds.size === 0 || "preferences" in input || "studyDaysOfWeek" in input || "plans" in input) {
    const plans = await ctx.db.query("plans").withIndex("by_owner", q => q.eq("ownerId", ownerId)).collect();
    for (const plan of plans) planIds.add(plan._id);
  }
  for (const planId of planIds) {
    const plan = await requireOwnedPlan(ctx, ownerId, planId);
    const revision = expected?.[planId];
    if (!Number.isSafeInteger(revision) || revision! < 0) {
      throw new Error("A displayed plan revision is required. Reload the planner before saving.");
    }
    if (revision !== planRevision(plan)) {
      throw new Error(await revisionConflictMessage(ctx, planId, revision!, planRevision(plan)));
    }
  }
}

export function browserMutation<A extends PropertyValidators, R>(definition: {
  args: A;
  returns: Validator<R, "required">;
  handler: (ctx: MutationCtx, args: ObjectType<A>) => Promise<R>;
}) {
  return mutation({
    args: { ...definition.args, expectedRevisions: v.optional(v.record(v.string(), v.number())) },
    returns: definition.returns,
    handler: async (ctx, args) => {
      const { expectedRevisions, ...input } = args;
      await checkBrowserRevisions(ctx, input, expectedRevisions);
      return await definition.handler(ctx, input as ObjectType<A>) as R extends null ? R | undefined | void : R;
    },
  });
}
