import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  commitAudit,
  executeCommandBatch,
  findIdempotentResult,
  loadPlanForMcp,
  MAX_PLAN_ENTITIES,
  planRevision,
  plannerCommandValidator,
  previewCommandBatch,
  requireOwnedPlan,
  revisionConflictMessage,
  storeIdempotentResult,
  undoAudit,
} from "./plannerApplication";
import { requireMcpPrincipal } from "./mcpOAuth";
import {
  assertBoundedText,
  assertFiniteBoundedNumber,
  assertIsoDate,
  assertProgress,
  assertTrimmedBoundedText,
  PLANNER_LIMITS,
} from "./plannerGuards";

const scopeValidator = v.union(
  v.literal("planner:read"),
  v.literal("planner:manage"),
  v.literal("planner:destructive"),
);

const authArgs = {
  tokenDigest: v.string(),
  issuer: v.string(),
  resource: v.string(),
};

const topicStatusValidator = v.union(v.literal("planned"), v.literal("active"), v.literal("done"));
const unitValidator = v.union(
  v.literal("slides"),
  v.literal("pages"),
  v.literal("cards"),
  v.literal("videos"),
  v.literal("hours"),
  v.literal("items"),
);
const mutationBase = {
  revision: v.number(),
  auditId: v.id("plannerAudit"),
  summary: v.string(),
};
const commandMutationResultValidator = v.object({
  ...mutationBase,
  createdIds: v.record(v.string(), v.string()),
  warnings: v.array(v.string()),
  affectedEntityIds: v.array(v.string()),
});

type CommandMutationResult = {
  revision: number;
  auditId: Id<"plannerAudit">;
  summary: string;
  createdIds: Record<string, string>;
  warnings: string[];
  affectedEntityIds: string[];
};
type CreatePlanResult = CommandMutationResult & { planId: Id<"plans"> };
type ProgressResult = {
  revision: number;
  auditId: Id<"plannerAudit">;
  summary: string;
  logId: Id<"studyLog">;
  topicId: Id<"topics">;
  completedUnits: number;
  status: "planned" | "active" | "done";
};
type UndoResult = Pick<CommandMutationResult, "revision" | "auditId" | "summary">;

function authInput(args: { tokenDigest: string; issuer: string; resource: string }, requiredScopes: string[]) {
  return { ...args, requiredScopes };
}

export const listPlans = query({
  args: { ...authArgs, today: v.optional(v.string()) },
  returns: v.object({
    plans: v.array(v.object({
      planId: v.id("plans"),
      name: v.string(),
      revision: v.number(),
      courseCount: v.number(),
      topicCount: v.number(),
      upcomingDeadlines: v.array(v.object({
        examId: v.string(),
        courseId: v.string(),
        courseName: v.string(),
        name: v.string(),
        date: v.string(),
        status: v.string(),
      })),
      updatedAt: v.number(),
    })),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, authInput(args, ["planner:read"]));
    if (args.today !== undefined) assertIsoDate(args.today, "Today");
    const plans = await ctx.db
      .query("plans")
      .withIndex("by_owner", (q) => q.eq("ownerId", principal.ownerId))
      .order("desc")
      .take(50);
    const result = [];
    for (const plan of plans) {
      const courses = await ctx.db.query("courses").withIndex("by_plan", (q) => q.eq("planId", plan._id)).take(100);
      const deadlines: Array<{ examId: string; courseId: string; courseName: string; name: string; date: string; status: string }> = [];
      let topicCount = 0;
      for (const course of courses) {
        const [exams, topics] = await Promise.all([
          ctx.db.query("exams").withIndex("by_course", (q) => q.eq("courseId", course._id)).take(250),
          ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", course._id)).take(500),
        ]);
        topicCount += topics.length;
        deadlines.push(
          ...exams
            .filter((exam) => args.today === undefined || exam.startDate >= args.today)
            .map((exam) => ({
              examId: exam._id,
              courseId: course._id,
              courseName: course.name,
              name: exam.name,
              date: exam.startDate,
              status: exam.status,
            })),
        );
      }
      result.push({
        planId: plan._id,
        name: plan.name,
        revision: planRevision(plan),
        courseCount: courses.length,
        topicCount,
        upcomingDeadlines: deadlines.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20),
        updatedAt: plan.updatedAt,
      });
    }
    return { plans: result, limit: 50, hasMore: plans.length === 50 };
  },
});

export const getPlan = query({
  args: { ...authArgs, planId: v.id("plans"), includeStudyLog: v.optional(v.boolean()) },
  returns: v.object({
    plan: v.object({
      id: v.id("plans"),
      name: v.string(),
      notes: v.string(),
      revision: v.number(),
      courses: v.array(v.object({
        id: v.string(),
        planId: v.string(),
        name: v.string(),
        code: v.optional(v.string()),
        color: v.string(),
        notes: v.string(),
        order: v.number(),
        exams: v.array(v.object({
          id: v.string(),
          courseId: v.string(),
          name: v.string(),
          kind: v.union(v.literal("exam"), v.literal("deadline"), v.literal("presentation"), v.literal("other")),
          startDate: v.string(),
          endDate: v.optional(v.string()),
          status: v.union(v.literal("confirmed"), v.literal("provisional")),
          notes: v.string(),
          order: v.number(),
        })),
        topics: v.array(v.object({
          id: v.string(),
          courseId: v.string(),
          name: v.string(),
          unit: unitValidator,
          totalUnits: v.number(),
          completedUnits: v.number(),
          status: topicStatusValidator,
          priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
          dependencyIds: v.array(v.string()),
          color: v.string(),
          notes: v.string(),
          order: v.number(),
          blocks: v.array(v.object({
            id: v.string(),
            topicId: v.string(),
            startDate: v.string(),
            endDate: v.string(),
            plannedUnits: v.optional(v.number()),
            source: v.union(v.literal("auto"), v.literal("manual")),
          })),
        })),
      })),
    }),
    preferences: v.object({
      dailyCapacityUnits: v.optional(v.number()),
      studyDaysOfWeek: v.array(v.number()),
      blackoutDates: v.array(v.string()),
      theme: v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
      accentColor: v.string(),
    }),
    timezone: v.string(),
    studyLog: v.array(v.object({
      _id: v.id("studyLog"),
      _creationTime: v.number(),
      topicId: v.id("topics"),
      date: v.string(),
      units: v.number(),
      minutes: v.optional(v.number()),
      note: v.optional(v.string()),
      createdAt: v.number(),
    })),
    limits: v.object({
      maximumEntities: v.number(),
      returnedStudyLogEntries: v.number(),
      continuation: v.string(),
    }),
  }),
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, authInput(args, ["planner:read"]));
    const state = await loadPlanForMcp(ctx, principal.ownerId, args.planId);
    const topicIds = new Set(state.courses.flatMap((course) => course.topics.map((topic) => topic.id)));
    const studyLog = args.includeStudyLog
      ? (await ctx.db
          .query("studyLog")
          .withIndex("by_owner", (q) => q.eq("ownerId", principal.ownerId))
          .order("desc")
          .take(500))
          .filter((entry) => topicIds.has(entry.topicId))
          .map((entry) => ({
            _id: entry._id,
            _creationTime: entry._creationTime,
            topicId: entry.topicId,
            date: entry.date,
            units: entry.units,
            minutes: entry.minutes,
            note: entry.note,
            createdAt: entry.createdAt,
          }))
      : [];
    return {
      plan: {
        id: state.plan._id,
        name: state.plan.name,
        notes: state.plan.notes,
        revision: planRevision(state.plan),
        courses: state.courses,
      },
      preferences: state.preferences,
      timezone: state.timezone,
      studyLog,
      limits: {
        maximumEntities: MAX_PLAN_ENTITIES,
        returnedStudyLogEntries: 500,
        continuation: "Use planner.history for older changes; plans above the entity limit must be split before MCP management.",
      },
    };
  },
});

export const previewChanges = query({
  args: { ...authArgs, planId: v.id("plans"), commands: v.array(plannerCommandValidator) },
  returns: v.object({
    revision: v.number(),
    resultingRevision: v.number(),
    summary: v.string(),
    warnings: v.array(v.string()),
    generatedBlocks: v.array(v.object({
      topicId: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      plannedUnits: v.number(),
    })),
    writesApplied: v.literal(false),
  }),
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, authInput(args, ["planner:read"]));
    return await previewCommandBatch(ctx, {
      ownerId: principal.ownerId,
      planId: args.planId,
      commands: args.commands,
    });
  },
});

export const createPlan = mutation({
  args: {
    ...authArgs,
    idempotencyKey: v.string(),
    name: v.string(),
    notes: v.optional(v.string()),
    commands: v.array(plannerCommandValidator),
  },
  returns: v.object({
    ...mutationBase,
    planId: v.id("plans"),
    createdIds: v.record(v.string(), v.string()),
    warnings: v.array(v.string()),
    affectedEntityIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, authInput(args, ["planner:manage"]));
    const retried = await findIdempotentResult<CreatePlanResult>(ctx, principal.grantId, args.idempotencyKey, "planner.create");
    if (retried !== null) return retried;
    assertTrimmedBoundedText(args.name, "Plan name", PLANNER_LIMITS.nameCharacters);
    assertBoundedText(args.notes ?? "", "Plan notes", PLANNER_LIMITS.notesCharacters);
    const now = Date.now();
    const planId = await ctx.db.insert("plans", {
      ownerId: principal.ownerId,
      name: args.name,
      notes: args.notes ?? "",
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    const execution = await executeCommandBatch(ctx, {
      ownerId: principal.ownerId,
      planId,
      commands: args.commands,
    });
    const revision = 1;
    await ctx.db.patch(planId, { revision, updatedAt: Date.now() });
    const summary = `Created plan ${args.name}; ${execution.summaries.join("; ")}`;
    const auditId = await commitAudit(ctx, {
      ownerId: principal.ownerId,
      planId,
      actorType: "mcp",
      grantId: principal.grantId,
      baseRevision: 0,
      resultRevision: revision,
      summary,
      affectedEntityIds: execution.affectedEntityIds,
    });
    const result = {
      planId,
      createdIds: execution.createdIds,
      revision,
      auditId,
      summary,
      warnings: execution.warnings,
      affectedEntityIds: execution.affectedEntityIds,
    };
    await storeIdempotentResult(ctx, principal.grantId, args.idempotencyKey, "planner.create", result);
    return result;
  },
});

export const applyChanges = mutation({
  args: {
    ...authArgs,
    planId: v.id("plans"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
    commands: v.array(plannerCommandValidator),
  },
  returns: commandMutationResultValidator,
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, authInput(args, ["planner:manage"]));
    const retried = await findIdempotentResult<CommandMutationResult>(ctx, principal.grantId, args.idempotencyKey, "planner.apply_changes");
    if (retried !== null) return retried;
    const plan = await requireOwnedPlan(ctx, principal.ownerId, args.planId);
    const baseRevision = planRevision(plan);
    if (baseRevision !== args.expectedRevision) {
      throw new Error(await revisionConflictMessage(ctx, args.planId, args.expectedRevision, baseRevision));
    }
    const execution = await executeCommandBatch(ctx, {
      ownerId: principal.ownerId,
      planId: args.planId,
      commands: args.commands,
    });
    const revision = baseRevision + 1;
    await ctx.db.patch(args.planId, { revision, updatedAt: Date.now() });
    const summary = execution.summaries.join("; ");
    const auditId = await commitAudit(ctx, {
      ownerId: principal.ownerId,
      planId: args.planId,
      actorType: "mcp",
      grantId: principal.grantId,
      baseRevision,
      resultRevision: revision,
      summary,
      affectedEntityIds: execution.affectedEntityIds,
      inverseCommands: execution.inverseCommands,
    });
    const result = {
      createdIds: execution.createdIds,
      revision,
      auditId,
      summary,
      warnings: execution.warnings,
      affectedEntityIds: execution.affectedEntityIds,
    };
    await storeIdempotentResult(ctx, principal.grantId, args.idempotencyKey, "planner.apply_changes", result);
    return result;
  },
});

export const recordProgress = mutation({
  args: {
    ...authArgs,
    planId: v.id("plans"),
    topicId: v.id("topics"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
    date: v.string(),
    units: v.number(),
    minutes: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  returns: v.object({
    ...mutationBase,
    logId: v.id("studyLog"),
    topicId: v.id("topics"),
    completedUnits: v.number(),
    status: topicStatusValidator,
  }),
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, authInput(args, ["planner:manage"]));
    const retried = await findIdempotentResult<ProgressResult>(ctx, principal.grantId, args.idempotencyKey, "planner.record_progress");
    if (retried !== null) return retried;
    const plan = await requireOwnedPlan(ctx, principal.ownerId, args.planId);
    const baseRevision = planRevision(plan);
    if (baseRevision !== args.expectedRevision) throw new Error(await revisionConflictMessage(ctx, args.planId, args.expectedRevision, baseRevision));
    const topic = await ctx.db.get(args.topicId);
    const course = topic ? await ctx.db.get(topic.courseId) : null;
    if (!topic || !course || course.planId !== args.planId) throw new Error("Topic not found in this plan");
    assertIsoDate(args.date, "Study date");
    assertFiniteBoundedNumber(args.units, "Units", { min: -PLANNER_LIMITS.units, max: PLANNER_LIMITS.units });
    if (args.minutes !== undefined) assertFiniteBoundedNumber(args.minutes, "Minutes", { min: 0, max: PLANNER_LIMITS.minutes });
    if (args.note !== undefined) assertBoundedText(args.note, "Study note", PLANNER_LIMITS.logNoteCharacters);
    const completedUnits = Math.max(0, topic.totalUnits > 0 ? Math.min(topic.totalUnits, topic.completedUnits + args.units) : topic.completedUnits + args.units);
    assertProgress(completedUnits, topic.totalUnits);
    const status: ProgressResult["status"] = completedUnits === 0
      ? "planned"
      : topic.totalUnits > 0 && completedUnits >= topic.totalUnits
        ? "done"
        : "active";
    const now = Date.now();
    await ctx.db.patch(topic._id, { completedUnits, status, updatedAt: now });
    const logId = await ctx.db.insert("studyLog", {
      ownerId: principal.ownerId,
      topicId: topic._id,
      date: args.date,
      units: args.units,
      minutes: args.minutes,
      note: args.note,
      createdAt: now,
    });
    const revision = baseRevision + 1;
    await ctx.db.patch(args.planId, { revision, updatedAt: now });
    const summary = `Recorded ${args.units} units of progress for ${topic.name}`;
    const auditId = await commitAudit(ctx, {
      ownerId: principal.ownerId,
      planId: args.planId,
      actorType: "mcp",
      grantId: principal.grantId,
      baseRevision,
      resultRevision: revision,
      summary,
      affectedEntityIds: [topic._id, logId],
      inverseCommands: [{ type: "progress.restore", topicId: topic._id, logId, completedUnits: topic.completedUnits, status: topic.status }],
    });
    const result = { revision, auditId, logId, topicId: topic._id, completedUnits, status, summary };
    await storeIdempotentResult(ctx, principal.grantId, args.idempotencyKey, "planner.record_progress", result);
    return result;
  },
});

export const history = query({
  args: {
    ...authArgs,
    planId: v.id("plans"),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  returns: v.object({
    changes: v.array(v.object({
      auditId: v.id("plannerAudit"),
      createdAt: v.number(),
      actorType: v.union(v.literal("user"), v.literal("mcp")),
      baseRevision: v.number(),
      resultRevision: v.number(),
      summary: v.string(),
      affectedEntityIds: v.array(v.string()),
      undoable: v.boolean(),
    })),
    nextCursor: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, authInput(args, ["planner:read"]));
    await requireOwnedPlan(ctx, principal.ownerId, args.planId);
    const limit = args.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("History limit must be an integer from 1 to 50");
    const rows = await ctx.db
      .query("plannerAudit")
      .withIndex("by_plan_and_created_at", (q) => {
        const plan = q.eq("planId", args.planId);
        return args.before === undefined ? plan : plan.lt("createdAt", args.before);
      })
      .order("desc")
      .take(limit + 1);
    const page = rows.slice(0, limit);
    return {
      changes: page.map((row) => ({
        auditId: row._id,
        createdAt: row.createdAt,
        actorType: row.actorType,
        baseRevision: row.baseRevision,
        resultRevision: row.resultRevision,
        summary: row.summary,
        affectedEntityIds: row.affectedEntityIds,
        undoable: row.undoable,
      })),
      nextCursor: rows.length > limit ? page.at(-1)?.createdAt ?? null : null,
    };
  },
});

export const undo = mutation({
  args: {
    ...authArgs,
    planId: v.id("plans"),
    auditId: v.id("plannerAudit"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.object(mutationBase),
  handler: async (ctx, args) => {
    const principal = await requireMcpPrincipal(ctx, authInput(args, ["planner:manage"]));
    const retried = await findIdempotentResult<UndoResult>(ctx, principal.grantId, args.idempotencyKey, "planner.undo");
    if (retried !== null) return retried;
    const result = await undoAudit(ctx, {
      ownerId: principal.ownerId,
      grantId: principal.grantId,
      planId: args.planId,
      auditId: args.auditId,
      expectedRevision: args.expectedRevision,
    });
    await storeIdempotentResult(ctx, principal.grantId, args.idempotencyKey, "planner.undo", result);
    return result;
  },
});

export const supportedScopes = query({
  args: {},
  returns: v.array(scopeValidator),
  handler: async () => [
    "planner:read" as const,
    "planner:manage" as const,
    "planner:destructive" as const,
  ],
});

export type PlanId = Id<"plans">;
