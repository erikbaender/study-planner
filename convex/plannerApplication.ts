import { v } from "convex/values";
import { commandStore, previewStore, type CommandStore } from "./plannerStore";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  assertBoundedArray,
  assertBoundedText,
  assertDistinctBoundedArray,
  assertFiniteBoundedNumber,
  assertIsoDate,
  assertOrderedIsoDates,
  assertPlannedUnits,
  assertPreferences,
  assertProgress,
  assertReorderComplete,
  assertTrimmedBoundedText,
  PLANNER_LIMITS,
} from "./plannerGuards";
import { schedule } from "../src/domain/scheduling";
import type { Course, Preferences, Topic } from "../src/domain/types";

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
const themeValidator = v.union(v.literal("system"), v.literal("light"), v.literal("dark"));

const courseInputValidator = v.object({
  name: v.string(),
  code: v.optional(v.string()),
  notes: v.optional(v.string()),
  color: v.string(),
});
const examInputValidator = v.object({
  name: v.string(),
  kind: v.optional(examKindValidator),
  startDate: v.string(),
  endDate: v.optional(v.string()),
  status: v.optional(examStatusValidator),
  notes: v.optional(v.string()),
});
const topicInputValidator = v.object({
  name: v.string(),
  unit: v.optional(unitValidator),
  totalUnits: v.optional(v.number()),
  priority: v.optional(priorityValidator),
  notes: v.optional(v.string()),
  color: v.string(),
});
const preferencesValidator = v.object({
  dailyCapacityUnits: v.optional(v.number()),
  studyDaysOfWeek: v.array(v.number()),
  blackoutDates: v.array(v.string()),
  theme: themeValidator,
  accentColor: v.string(),
  timezone: v.optional(v.string()),
});

/** Explicit domain commands accepted by preview/apply; no natural-language dispatch. */
export const plannerCommandValidator = v.union(
  v.object({
    type: v.literal("plan.update"),
    patch: v.object({ name: v.optional(v.string()), notes: v.optional(v.string()) }),
  }),
  v.object({ type: v.literal("course.create"), ref: v.string(), input: courseInputValidator }),
  v.object({
    type: v.literal("course.update"),
    courseId: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      code: v.optional(v.string()),
      notes: v.optional(v.string()),
      color: v.optional(v.string()),
    }),
  }),
  v.object({
    type: v.literal("exam.create"),
    courseId: v.string(),
    ref: v.string(),
    input: examInputValidator,
  }),
  v.object({
    type: v.literal("exam.update"),
    examId: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      kind: v.optional(examKindValidator),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      status: v.optional(examStatusValidator),
      notes: v.optional(v.string()),
    }),
  }),
  v.object({
    type: v.literal("topic.create"),
    courseId: v.string(),
    ref: v.string(),
    input: topicInputValidator,
  }),
  v.object({
    type: v.literal("topic.update"),
    topicId: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      unit: v.optional(unitValidator),
      totalUnits: v.optional(v.number()),
      completedUnits: v.optional(v.number()),
      status: v.optional(statusValidator),
      priority: v.optional(priorityValidator),
      notes: v.optional(v.string()),
      color: v.optional(v.string()),
    }),
  }),
  v.object({
    type: v.literal("topic.reorder"),
    courseId: v.string(),
    topicIds: v.array(v.string()),
  }),
  v.object({
    type: v.literal("topic.dependencies.set"),
    topicId: v.string(),
    dependencyIds: v.array(v.string()),
  }),
  v.object({
    type: v.literal("block.create"),
    topicId: v.string(),
    ref: v.string(),
    input: v.object({
      startDate: v.string(),
      endDate: v.string(),
      plannedUnits: v.optional(v.number()),
      source: v.optional(v.union(v.literal("auto"), v.literal("manual"))),
    }),
  }),
  v.object({
    type: v.literal("block.move"),
    blockId: v.string(),
    startDate: v.string(),
    endDate: v.string(),
  }),
  v.object({
    type: v.literal("block.resize"),
    blockId: v.string(),
    endDate: v.string(),
    plannedUnits: v.optional(v.number()),
  }),
  v.object({
    type: v.literal("schedule.regenerate"),
    today: v.string(),
    courseIds: v.optional(v.array(v.string())),
  }),
  v.object({ type: v.literal("preferences.update"), patch: preferencesValidator }),
);

export type PlannerCommand = (typeof plannerCommandValidator)["type"];
type PlannerReadCtx = { db: Pick<QueryCtx["db"], "get" | "normalizeId"> };
type CommandContext = { db: CommandStore };
type Ref = { table: "courses" | "exams" | "topics" | "studyBlocks"; id: string };

export const MAX_COMMANDS = 100;
export const MAX_PLAN_ENTITIES = 2_000;
const UNDO_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

export function planRevision(plan: Pick<Doc<"plans">, "revision">) {
  return plan.revision ?? 0;
}

function assertRef(ref: string) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(ref)) {
    throw new Error("Document-local references must start with a letter and contain only letters, numbers, _ or -");
  }
}

function assertColor(color: string) {
  const allowed = new Set([
    "coral", "tangerine", "gold", "lime", "chartreuse", "jade", "turquoise", "violet", "orchid", "rose",
  ]);
  if (!allowed.has(color)) throw new Error("Color must be a supported course palette id");
}

function validateCourseInput(input: { name: string; code?: string; notes?: string; color: string }) {
  assertTrimmedBoundedText(input.name, "Course name", PLANNER_LIMITS.nameCharacters);
  if (input.code !== undefined) assertTrimmedBoundedText(input.code, "Course code", PLANNER_LIMITS.codeCharacters);
  assertBoundedText(input.notes ?? "", "Course notes", PLANNER_LIMITS.notesCharacters);
  assertColor(input.color);
}

function validateExamInput(input: {
  name: string;
  startDate: string;
  endDate?: string;
  notes?: string;
}) {
  assertTrimmedBoundedText(input.name, "Exam name", PLANNER_LIMITS.nameCharacters);
  assertBoundedText(input.notes ?? "", "Exam notes", PLANNER_LIMITS.notesCharacters);
  assertOrderedIsoDates(input.startDate, input.endDate);
}

function validateTopicInput(input: {
  name: string;
  totalUnits?: number;
  notes?: string;
  color: string;
}) {
  assertTrimmedBoundedText(input.name, "Topic name", PLANNER_LIMITS.nameCharacters);
  assertBoundedText(input.notes ?? "", "Topic notes", PLANNER_LIMITS.notesCharacters);
  assertProgress(0, input.totalUnits ?? 0);
  assertColor(input.color);
}

function validateCommandShape(command: PlannerCommand) {
  switch (command.type) {
    case "plan.update":
      if (command.patch.name !== undefined) assertTrimmedBoundedText(command.patch.name, "Plan name", PLANNER_LIMITS.nameCharacters);
      if (command.patch.notes !== undefined) assertBoundedText(command.patch.notes, "Plan notes", PLANNER_LIMITS.notesCharacters);
      break;
    case "course.create":
      assertRef(command.ref);
      validateCourseInput(command.input);
      break;
    case "course.update":
      if (command.patch.name !== undefined) assertTrimmedBoundedText(command.patch.name, "Course name", PLANNER_LIMITS.nameCharacters);
      if (command.patch.code !== undefined) assertTrimmedBoundedText(command.patch.code, "Course code", PLANNER_LIMITS.codeCharacters);
      if (command.patch.notes !== undefined) assertBoundedText(command.patch.notes, "Course notes", PLANNER_LIMITS.notesCharacters);
      if (command.patch.color !== undefined) assertColor(command.patch.color);
      break;
    case "exam.create":
      assertRef(command.ref);
      validateExamInput(command.input);
      break;
    case "exam.update":
      if (command.patch.name !== undefined) assertTrimmedBoundedText(command.patch.name, "Exam name", PLANNER_LIMITS.nameCharacters);
      if (command.patch.notes !== undefined) assertBoundedText(command.patch.notes, "Exam notes", PLANNER_LIMITS.notesCharacters);
      if (command.patch.startDate !== undefined) assertIsoDate(command.patch.startDate, "Start date");
      if (command.patch.endDate !== undefined) assertIsoDate(command.patch.endDate, "End date");
      break;
    case "topic.create":
      assertRef(command.ref);
      validateTopicInput(command.input);
      break;
    case "topic.update":
      if (command.patch.name !== undefined) assertTrimmedBoundedText(command.patch.name, "Topic name", PLANNER_LIMITS.nameCharacters);
      if (command.patch.notes !== undefined) assertBoundedText(command.patch.notes, "Topic notes", PLANNER_LIMITS.notesCharacters);
      if (command.patch.color !== undefined) assertColor(command.patch.color);
      if (command.patch.totalUnits !== undefined) {
        assertFiniteBoundedNumber(command.patch.totalUnits, "Total units", { min: 0, max: PLANNER_LIMITS.units });
      }
      if (command.patch.completedUnits !== undefined) {
        assertFiniteBoundedNumber(command.patch.completedUnits, "Completed units", { min: 0, max: PLANNER_LIMITS.units });
      }
      if (command.patch.totalUnits !== undefined && command.patch.completedUnits !== undefined) {
        assertProgress(command.patch.completedUnits, command.patch.totalUnits);
      }
      break;
    case "topic.reorder":
      assertDistinctBoundedArray(command.topicIds, "Topic ids", PLANNER_LIMITS.reorderItems);
      break;
    case "topic.dependencies.set":
      assertDistinctBoundedArray(command.dependencyIds, "Dependency ids", PLANNER_LIMITS.dependencyIds);
      break;
    case "block.create":
      assertRef(command.ref);
      assertOrderedIsoDates(command.input.startDate, command.input.endDate);
      assertPlannedUnits(command.input.plannedUnits);
      break;
    case "block.move":
      assertOrderedIsoDates(command.startDate, command.endDate);
      break;
    case "block.resize":
      assertIsoDate(command.endDate, "End date");
      assertPlannedUnits(command.plannedUnits);
      break;
    case "schedule.regenerate":
      assertIsoDate(command.today, "Today");
      if (command.courseIds) assertDistinctBoundedArray(command.courseIds, "Course ids", 50);
      break;
    case "preferences.update":
      assertPreferences(command.patch);
      if (command.patch.timezone !== undefined) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: command.patch.timezone });
        } catch {
          throw new Error("Timezone must be a valid IANA timezone");
        }
      }
      break;
  }
}

export function validateCommandBatch(commands: PlannerCommand[]) {
  assertBoundedArray(commands, "Planner commands", MAX_COMMANDS);
  if (commands.length === 0) throw new Error("At least one planner command is required");
  const refs = new Set<string>();
  for (const command of commands) {
    validateCommandShape(command);
    if ("ref" in command) {
      if (refs.has(command.ref)) throw new Error(`Document-local reference ${command.ref} is duplicated`);
      refs.add(command.ref);
    }
  }
}

export async function requireOwnedPlan(ctx: PlannerReadCtx, ownerId: Id<"users">, planId: Id<"plans">) {
  const plan = await ctx.db.get(planId);
  if (!plan || plan.ownerId !== ownerId) throw new Error("Plan not found");
  return plan;
}

function resolveId<T extends "courses" | "exams" | "topics" | "studyBlocks">(
  ctx: PlannerReadCtx,
  refs: ReadonlyMap<string, Ref>,
  table: T,
  value: string,
): Id<T> {
  const ref = refs.get(value);
  if (ref) {
    if (ref.table !== table) throw new Error(`Reference ${value} does not name a ${table} entity`);
    return ref.id as Id<T>;
  }
  const normalized = ctx.db.normalizeId(table, value);
  if (!normalized) throw new Error(`${table} id ${value} is invalid`);
  return normalized;
}

async function assertCourseInPlan(ctx: PlannerReadCtx, planId: Id<"plans">, courseId: Id<"courses">) {
  const course = await ctx.db.get(courseId);
  if (!course || course.planId !== planId) throw new Error("Course not found in this plan");
  return course;
}

async function assertExamInPlan(ctx: PlannerReadCtx, planId: Id<"plans">, examId: Id<"exams">) {
  const exam = await ctx.db.get(examId);
  if (!exam) throw new Error("Exam not found in this plan");
  await assertCourseInPlan(ctx, planId, exam.courseId);
  return exam;
}

async function assertTopicInPlan(ctx: PlannerReadCtx, planId: Id<"plans">, topicId: Id<"topics">) {
  const topic = await ctx.db.get(topicId);
  if (!topic) throw new Error("Topic not found in this plan");
  const course = await assertCourseInPlan(ctx, planId, topic.courseId);
  return { topic, course };
}

async function assertBlockInPlan(ctx: PlannerReadCtx, planId: Id<"plans">, blockId: Id<"studyBlocks">) {
  const block = await ctx.db.get(blockId);
  if (!block) throw new Error("Study block not found in this plan");
  await assertTopicInPlan(ctx, planId, block.topicId);
  return block;
}

function nextOrder(rows: Array<{ order: number }>) {
  return rows.reduce((highest, row) => Math.max(highest, row.order + 1), 0);
}

export async function loadPlanForMcp(ctx: QueryCtx | MutationCtx, ownerId: Id<"users">, planId: Id<"plans">) {
  return loadCommandPlan({ db: previewStore(ctx.db) }, ownerId, planId);
}

async function loadCommandPlan(ctx: CommandContext, ownerId: Id<"users">, planId: Id<"plans">) {
  const plan = await requireOwnedPlan(ctx, ownerId, planId);
  const courseRows = await ctx.db.list("courses", "planId", planId, 101);
  if (courseRows.length > 100) throw new Error("Plan exceeds the 100-course MCP limit");
  const courses: Course[] = [];
  let entities = courseRows.length;
  for (const course of courseRows) {
    const [examRows, topicRows] = await Promise.all([
      ctx.db.list("exams", "courseId", course._id, 251),
      ctx.db.list("topics", "courseId", course._id, 501),
    ]);
    if (examRows.length > 250 || topicRows.length > 500) throw new Error("Course exceeds the MCP entity limit");
    entities += examRows.length + topicRows.length;
    if (entities > MAX_PLAN_ENTITIES) throw new Error("Plan exceeds the MCP entity limit");
    const topics: Topic[] = [];
    for (const topic of topicRows) {
      const blocks = await ctx.db.list("studyBlocks", "topicId", topic._id, 501);
      if (blocks.length > 500) throw new Error("Topic exceeds the 500-block MCP limit");
      entities += blocks.length;
      if (entities > MAX_PLAN_ENTITIES) throw new Error(`Plan exceeds the ${MAX_PLAN_ENTITIES}-entity MCP limit`);
      topics.push({
        id: topic._id,
        courseId: topic.courseId,
        name: topic.name,
        unit: topic.unit,
        totalUnits: topic.totalUnits,
        completedUnits: topic.completedUnits,
        status: topic.status,
        priority: topic.priority,
        dependencyIds: topic.dependencyIds,
        color: topic.color,
        notes: topic.notes,
        order: topic.order,
        blocks: blocks.map((block) => ({
          id: block._id,
          topicId: block.topicId,
          startDate: block.startDate,
          endDate: block.endDate,
          plannedUnits: block.plannedUnits,
          source: block.source,
        })),
      });
    }
    courses.push({
      id: course._id,
      planId: course.planId,
      name: course.name,
      code: course.code,
      color: course.color,
      notes: course.notes,
      order: course.order,
      exams: examRows.map((exam) => ({
        id: exam._id,
        courseId: exam.courseId,
        name: exam.name,
        kind: exam.kind,
        startDate: exam.startDate,
        endDate: exam.endDate,
        status: exam.status,
        notes: exam.notes,
        order: exam.order,
      })),
      topics,
    });
  }
  const row = (await ctx.db.list("preferences", "ownerId", ownerId, 2))[0] ?? null;
  const preferences: Preferences = row
    ? {
        dailyCapacityUnits: row.dailyCapacityUnits,
        studyDaysOfWeek: row.studyDaysOfWeek.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) as Preferences["studyDaysOfWeek"],
        blackoutDates: row.blackoutDates,
        theme: row.theme,
        accentColor: row.accentColor,
      }
    : { studyDaysOfWeek: [1, 2, 3, 4, 5, 6], blackoutDates: [], theme: "system", accentColor: "#1769e0" };
  return { plan, courses, preferences, timezone: row?.timezone ?? "UTC" };
}

async function regenerateSchedule(
  ctx: CommandContext,
  ownerId: Id<"users">,
  planId: Id<"plans">,
  today: string,
  courseIds?: string[],
) {
  const state = await loadCommandPlan(ctx, ownerId, planId);
  const requested = courseIds ? new Set(courseIds.map((id) => resolveId(ctx, new Map(), "courses", id))) : null;
  const courses = requested ? state.courses.filter((course) => requested.has(course.id as Id<"courses">)) : state.courses;
  if (requested && courses.length !== requested.size) throw new Error("Every schedule course must belong to this plan");
  const result = schedule({
    courses,
    today,
    calendar: { studyDaysOfWeek: state.preferences.studyDaysOfWeek, blackoutDates: state.preferences.blackoutDates },
    dailyCapacityUnits: state.preferences.dailyCapacityUnits,
  });
  const topicIds = courses.flatMap((course) => course.topics.map((topic) => topic.id as Id<"topics">));
  const oldAuto: Array<Omit<Doc<"studyBlocks">, "_id" | "_creationTime">> = [];
  for (const topicId of topicIds) {
    const rows = (await ctx.db.list("studyBlocks", "topicId", topicId, PLANNER_LIMITS.reflowBlocks + 1)).filter(block => block.source === "auto");
    oldAuto.push(
      ...rows.map((row) => ({
        topicId: row.topicId,
        startDate: row.startDate,
        endDate: row.endDate,
        plannedUnits: row.plannedUnits,
        source: row.source,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    );
  }
  if (oldAuto.length > PLANNER_LIMITS.reflowBlocks || result.blocks.length > PLANNER_LIMITS.reflowBlocks) {
    throw new Error("Generated schedule exceeds the block limit");
  }
  for (const topicId of topicIds) {
    const rows = (await ctx.db.list("studyBlocks", "topicId", topicId, PLANNER_LIMITS.reflowBlocks + 1)).filter(block => block.source === "auto");
    for (const row of rows) await ctx.db.delete(row._id);
  }
  const now = Date.now();
  for (const block of result.blocks) {
    await ctx.db.insert("studyBlocks", {
      topicId: block.topicId as Id<"topics">,
      startDate: block.startDate,
      endDate: block.endDate,
      plannedUnits: block.plannedUnits,
      source: "auto",
      createdAt: now,
      updatedAt: now,
    });
  }
  return { result, topicIds, oldAuto };
}

type InverseCommand = Doc<"plannerUndo">["inverseCommands"][number];

type ExecutionResult = {
  createdIds: Record<string, string>;
  affectedEntityIds: string[];
  summaries: string[];
  warnings: string[];
  inverseCommands: InverseCommand[];
  generatedBlocks: Array<{ topicId: string; startDate: string; endDate: string; plannedUnits: number }>;
};

/** Preview and apply run the same sequential evaluator against different stores. */
export async function previewCommandBatch(
  ctx: QueryCtx,
  args: { ownerId: Id<"users">; planId: Id<"plans">; commands: PlannerCommand[] },
) {
  const store = { db: previewStore(ctx.db) };
  const plan = await requireOwnedPlan(store, args.ownerId, args.planId);
  const execution = await evaluateCommands(store, args);
  return {
    revision: planRevision(plan),
    resultingRevision: planRevision(plan) + 1,
    summary: execution.summaries.join("; "),
    warnings: execution.warnings,
    generatedBlocks: execution.generatedBlocks,
    writesApplied: false as const,
  };
}

export async function executeCommandBatch(
  ctx: MutationCtx,
  args: { ownerId: Id<"users">; planId: Id<"plans">; commands: PlannerCommand[] },
): Promise<ExecutionResult> {
  return evaluateCommands({ db: commandStore(ctx.db) }, args);
}

function changedFields<T extends object>(before: T, patch: Partial<T>): Partial<T> {
  return Object.fromEntries(Object.keys(patch).map(key => [key, before[key as keyof T]])) as Partial<T>;
}

async function evaluateCommands(
  ctx: CommandContext,
  args: { ownerId: Id<"users">; planId: Id<"plans">; commands: PlannerCommand[] },
): Promise<ExecutionResult> {
  validateCommandBatch(args.commands);
  await requireOwnedPlan(ctx, args.ownerId, args.planId);
  const refs = new Map<string, Ref>();
  const affected = new Set<string>([args.planId]);
  const summaries: string[] = [];
  const warnings: string[] = [];
  const inverseCommands: InverseCommand[] = [];
  let generatedBlocks: ExecutionResult["generatedBlocks"] = [];

  for (const command of args.commands) {
    const now = Date.now();
    switch (command.type) {
      case "plan.update": {
        const before = await requireOwnedPlan(ctx, args.ownerId, args.planId);
        if (command.patch.name !== undefined || command.patch.notes !== undefined) {
          await ctx.db.patch(args.planId, { ...command.patch, updatedAt: now });
          inverseCommands.unshift({ type: "plan.update", patch: changedFields(before, command.patch) });
          summaries.push("Updated plan details");
        }
        break;
      }
      case "course.create": {
        const existing = await ctx.db.list("courses", "planId", args.planId, 101);
        if (existing.length >= 100) throw new Error("A plan cannot contain more than 100 courses");
        const id = await ctx.db.insert("courses", {
          planId: args.planId,
          name: command.input.name,
          code: command.input.code,
          notes: command.input.notes ?? "",
          color: command.input.color,
          order: nextOrder(existing),
          createdAt: now,
          updatedAt: now,
        });
        refs.set(command.ref, { table: "courses", id });
        affected.add(id);
        inverseCommands.unshift({ type: "course.delete", courseId: id });
        summaries.push(`Created course ${command.input.name}`);
        break;
      }
      case "course.update": {
        const id = resolveId(ctx, refs, "courses", command.courseId);
        const before = await assertCourseInPlan(ctx, args.planId, id);
        await ctx.db.patch(id, { ...command.patch, updatedAt: now });
        inverseCommands.unshift({
          type: "course.update",
          courseId: id,
          patch: { ...changedFields(before, command.patch), code: "code" in command.patch ? before.code ?? null : undefined },
        });
        affected.add(id);
        summaries.push(`Updated course ${before.name}`);
        break;
      }
      case "exam.create": {
        const courseId = resolveId(ctx, refs, "courses", command.courseId);
        await assertCourseInPlan(ctx, args.planId, courseId);
        const existing = await ctx.db.list("exams", "courseId", courseId, 251);
        const id = await ctx.db.insert("exams", {
          courseId,
          name: command.input.name,
          kind: command.input.kind ?? "exam",
          startDate: command.input.startDate,
          endDate: command.input.endDate,
          status: command.input.status ?? (command.input.endDate ? "provisional" : "confirmed"),
          notes: command.input.notes ?? "",
          order: nextOrder(existing),
          createdAt: now,
          updatedAt: now,
        });
        refs.set(command.ref, { table: "exams", id });
        affected.add(id);
        inverseCommands.unshift({ type: "exam.delete", examId: id });
        summaries.push(`Created exam ${command.input.name}`);
        break;
      }
      case "exam.update": {
        const id = resolveId(ctx, refs, "exams", command.examId);
        const before = await assertExamInPlan(ctx, args.planId, id);
        const startDate = command.patch.startDate ?? before.startDate;
        const endDate = command.patch.endDate ?? before.endDate;
        assertOrderedIsoDates(startDate, endDate);
        await ctx.db.patch(id, { ...command.patch, updatedAt: now });
        inverseCommands.unshift({
          type: "exam.update",
          examId: id,
          patch: { ...changedFields(before, command.patch), endDate: "endDate" in command.patch ? before.endDate ?? null : undefined },
        });
        affected.add(id);
        summaries.push(`Updated exam ${before.name}`);
        break;
      }
      case "topic.create": {
        const courseId = resolveId(ctx, refs, "courses", command.courseId);
        await assertCourseInPlan(ctx, args.planId, courseId);
        const existing = await ctx.db.list("topics", "courseId", courseId, 501);
        const id = await ctx.db.insert("topics", {
          courseId,
          name: command.input.name,
          unit: command.input.unit ?? "slides",
          totalUnits: command.input.totalUnits ?? 0,
          completedUnits: 0,
          status: "planned",
          priority: command.input.priority ?? "normal",
          dependencyIds: [],
          color: command.input.color,
          notes: command.input.notes ?? "",
          order: nextOrder(existing),
          createdAt: now,
          updatedAt: now,
        });
        refs.set(command.ref, { table: "topics", id });
        affected.add(id);
        inverseCommands.unshift({ type: "topic.delete", topicId: id });
        summaries.push(`Created topic ${command.input.name}`);
        break;
      }
      case "topic.update": {
        const id = resolveId(ctx, refs, "topics", command.topicId);
        const { topic: before } = await assertTopicInPlan(ctx, args.planId, id);
        const totalUnits = command.patch.totalUnits ?? before.totalUnits;
        const completedUnits = command.patch.completedUnits ?? before.completedUnits;
        assertProgress(completedUnits, totalUnits);
        await ctx.db.patch(id, { ...command.patch, updatedAt: now });
        inverseCommands.unshift({
          type: "topic.update",
          topicId: id,
          patch: changedFields(before, command.patch),
        });
        affected.add(id);
        summaries.push(`Updated topic ${before.name}`);
        break;
      }
      case "topic.reorder": {
        const courseId = resolveId(ctx, refs, "courses", command.courseId);
        await assertCourseInPlan(ctx, args.planId, courseId);
        const topics = await ctx.db.list("topics", "courseId", courseId, 501);
        const ids = command.topicIds.map((id) => resolveId(ctx, refs, "topics", id));
        assertReorderComplete(topics.map((topic) => topic._id), ids, "Topic ids");
        const oldOrder = [...topics].sort((a, b) => a.order - b.order).map((topic) => topic._id);
        for (const [order, id] of ids.entries()) await ctx.db.patch(id, { order, updatedAt: now });
        inverseCommands.unshift({ type: "topic.reorder", courseId, topicIds: oldOrder });
        ids.forEach((id) => affected.add(id));
        summaries.push("Reordered topics");
        break;
      }
      case "topic.dependencies.set": {
        const topicId = resolveId(ctx, refs, "topics", command.topicId);
        const { topic } = await assertTopicInPlan(ctx, args.planId, topicId);
        const dependencyIds = command.dependencyIds.map((id) => resolveId(ctx, refs, "topics", id));
        if (dependencyIds.includes(topicId)) throw new Error("A topic cannot depend on itself");
        for (const dependencyId of dependencyIds) {
          const { topic: dependency } = await assertTopicInPlan(ctx, args.planId, dependencyId);
          if (dependency.courseId !== topic.courseId) throw new Error("Dependencies must be in the same course");
        }
        const graphRows = await ctx.db.list("topics", "courseId", topic.courseId, 501);
        const graph = new Map(graphRows.map((row) => [row._id as string, row.dependencyIds as string[]]));
        graph.set(topicId, dependencyIds);
        const visits = new Set<string>();
        const path = new Set<string>();
        const cyclic = (id: string): boolean => {
          if (path.has(id)) return true;
          if (visits.has(id)) return false;
          visits.add(id);
          path.add(id);
          for (const dependency of graph.get(id) ?? []) if (cyclic(dependency)) return true;
          path.delete(id);
          return false;
        };
        if ([...graph.keys()].some(cyclic)) throw new Error("Topic dependencies cannot create a cycle");
        await ctx.db.patch(topicId, { dependencyIds, updatedAt: now });
        inverseCommands.unshift({ type: "topic.dependencies.set", topicId, dependencyIds: topic.dependencyIds });
        affected.add(topicId);
        summaries.push(`Updated dependencies for ${topic.name}`);
        break;
      }
      case "block.create": {
        const topicId = resolveId(ctx, refs, "topics", command.topicId);
        await assertTopicInPlan(ctx, args.planId, topicId);
        const id = await ctx.db.insert("studyBlocks", {
          topicId,
          startDate: command.input.startDate,
          endDate: command.input.endDate,
          plannedUnits: command.input.plannedUnits,
          source: command.input.source ?? "manual",
          createdAt: now,
          updatedAt: now,
        });
        refs.set(command.ref, { table: "studyBlocks", id });
        affected.add(id);
        inverseCommands.unshift({ type: "block.delete", blockId: id });
        summaries.push("Created study block");
        break;
      }
      case "block.move": {
        const id = resolveId(ctx, refs, "studyBlocks", command.blockId);
        const before = await assertBlockInPlan(ctx, args.planId, id);
        await ctx.db.patch(id, { startDate: command.startDate, endDate: command.endDate, source: "manual", updatedAt: now });
        inverseCommands.unshift({ type: "block.restore", blockId: id, value: { startDate: before.startDate, endDate: before.endDate, plannedUnits: before.plannedUnits, source: before.source } });
        affected.add(id);
        summaries.push("Moved study block");
        break;
      }
      case "block.resize": {
        const id = resolveId(ctx, refs, "studyBlocks", command.blockId);
        const before = await assertBlockInPlan(ctx, args.planId, id);
        assertOrderedIsoDates(before.startDate, command.endDate);
        await ctx.db.patch(id, { endDate: command.endDate, plannedUnits: command.plannedUnits ?? before.plannedUnits, source: "manual", updatedAt: now });
        inverseCommands.unshift({ type: "block.restore", blockId: id, value: { startDate: before.startDate, endDate: before.endDate, plannedUnits: before.plannedUnits, source: before.source } });
        affected.add(id);
        summaries.push("Resized study block");
        break;
      }
      case "schedule.regenerate": {
        const regenerated = await regenerateSchedule(ctx, args.ownerId, args.planId, command.today, command.courseIds?.map(id => resolveId(ctx, refs, "courses", id)));
        generatedBlocks = regenerated.result.blocks;
        regenerated.topicIds.forEach((id) => affected.add(id));
        warnings.push(...regenerated.result.shortfalls.map((shortfall) => `${shortfall.courseName}: ${shortfall.unscheduledUnits} units could not be scheduled before ${shortfall.deadline}`));
        inverseCommands.unshift({ type: "schedule.restore", topicIds: regenerated.topicIds, blocks: regenerated.oldAuto });
        summaries.push(`Regenerated ${regenerated.result.blocks.length} study blocks`);
        break;
      }
      case "preferences.update": {
        const before = (await ctx.db.list("preferences", "ownerId", args.ownerId, 2))[0] ?? null;
        if (before) await ctx.db.patch(before._id, { ...command.patch, revision: (before.revision ?? 0) + 1, updatedAt: now });
        else await ctx.db.insert("preferences", { ownerId: args.ownerId, ...command.patch, revision: 1, updatedAt: now });
        inverseCommands.unshift({ type: "preferences.restore", value: before ? { dailyCapacityUnits: before.dailyCapacityUnits, studyDaysOfWeek: before.studyDaysOfWeek, blackoutDates: before.blackoutDates, theme: before.theme, accentColor: before.accentColor, timezone: before.timezone } : null });
        summaries.push("Updated scheduling preferences");
        break;
      }
    }
  }
  await loadCommandPlan(ctx, args.ownerId, args.planId);
  return {
    createdIds: Object.fromEntries([...refs.entries()].map(([ref, value]) => [ref, value.id])),
    affectedEntityIds: [...affected].slice(0, 500),
    summaries,
    warnings,
    inverseCommands,
    generatedBlocks,
  };
}

async function deleteTopic(ctx: MutationCtx, topic: Doc<"topics">) {
  const blocks = await ctx.db.query("studyBlocks").withIndex("by_topic", (q) => q.eq("topicId", topic._id)).take(501);
  const logs = await ctx.db.query("studyLog").withIndex("by_topic", (q) => q.eq("topicId", topic._id)).take(501);
  for (const block of blocks) await ctx.db.delete(block._id);
  for (const log of logs) await ctx.db.delete(log._id);
  await ctx.db.delete(topic._id);
}

async function executeInverseCommands(ctx: MutationCtx, ownerId: Id<"users">, planId: Id<"plans">, commands: InverseCommand[]) {
  await requireOwnedPlan(ctx, ownerId, planId);
  for (const command of commands) {
    switch (command.type) {
      case "plan.update":
        await ctx.db.patch(planId, { ...command.patch, updatedAt: Date.now() });
        break;
      case "course.delete": {
        const course = await assertCourseInPlan(ctx, planId, command.courseId);
        const exams = await ctx.db.query("exams").withIndex("by_course", (q) => q.eq("courseId", course._id)).take(251);
        const topics = await ctx.db.query("topics").withIndex("by_course", (q) => q.eq("courseId", course._id)).take(501);
        for (const exam of exams) await ctx.db.delete(exam._id);
        for (const topic of topics) await deleteTopic(ctx, topic);
        await ctx.db.delete(course._id);
        break;
      }
      case "course.update": {
        const { code, ...patch } = command.patch;
        await assertCourseInPlan(ctx, planId, command.courseId);
        await ctx.db.patch(command.courseId, { ...patch, ...("code" in command.patch ? { code: code ?? undefined } : {}), updatedAt: Date.now() });
        break;
      }
      case "exam.delete":
        await assertExamInPlan(ctx, planId, command.examId);
        await ctx.db.delete(command.examId);
        break;
      case "exam.update": {
        const { endDate, ...patch } = command.patch;
        await assertExamInPlan(ctx, planId, command.examId);
        await ctx.db.patch(command.examId, { ...patch, ...("endDate" in command.patch ? { endDate: endDate ?? undefined } : {}), updatedAt: Date.now() });
        break;
      }
      case "topic.delete": {
        const { topic } = await assertTopicInPlan(ctx, planId, command.topicId);
        await deleteTopic(ctx, topic);
        break;
      }
      case "topic.update":
        await assertTopicInPlan(ctx, planId, command.topicId);
        await ctx.db.patch(command.topicId, { ...command.patch, updatedAt: Date.now() });
        break;
      case "topic.reorder":
        for (const [order, id] of command.topicIds.entries()) {
          await assertTopicInPlan(ctx, planId, id);
          await ctx.db.patch(id, { order, updatedAt: Date.now() });
        }
        break;
      case "topic.dependencies.set":
        await assertTopicInPlan(ctx, planId, command.topicId);
        await ctx.db.patch(command.topicId, { dependencyIds: command.dependencyIds, updatedAt: Date.now() });
        break;
      case "block.delete":
        await assertBlockInPlan(ctx, planId, command.blockId);
        await ctx.db.delete(command.blockId);
        break;
      case "block.restore":
        await assertBlockInPlan(ctx, planId, command.blockId);
        await ctx.db.patch(command.blockId, { ...command.value, plannedUnits: command.value.plannedUnits, updatedAt: Date.now() });
        break;
      case "schedule.restore": {
        for (const topicId of command.topicIds) {
          await assertTopicInPlan(ctx, planId, topicId);
          const rows = await ctx.db.query("studyBlocks").withIndex("by_topic_and_source", (q) => q.eq("topicId", topicId).eq("source", "auto")).take(1001);
          for (const row of rows) await ctx.db.delete(row._id);
        }
        for (const block of command.blocks) await ctx.db.insert("studyBlocks", block);
        break;
      }
      case "preferences.restore": {
        const existing = await ctx.db.query("preferences").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).unique();
        if (command.value === null) {
          if (existing) await ctx.db.delete(existing._id);
        } else if (existing) await ctx.db.patch(existing._id, { ...command.value, revision: (existing.revision ?? 0) + 1, updatedAt: Date.now() });
        else await ctx.db.insert("preferences", { ownerId, ...command.value, revision: 1, updatedAt: Date.now() });
        break;
      }
      case "progress.restore": {
        const { topic } = await assertTopicInPlan(ctx, planId, command.topicId);
        if (topic._id !== command.topicId) throw new Error("Progress topic not found");
        const logId = ctx.db.normalizeId("studyLog", command.logId);
        if (logId) {
          const log = await ctx.db.get(logId);
          if (log && log.ownerId === ownerId && log.topicId === topic._id) await ctx.db.delete(logId);
        }
        await ctx.db.patch(topic._id, {
          completedUnits: command.completedUnits,
          status: command.status,
          updatedAt: Date.now(),
        });
        break;
      }
      default:
        throw new Error("Stored undo operation is not supported");
    }
  }
}

export async function revisionConflictMessage(ctx: QueryCtx | MutationCtx, planId: Id<"plans">, expected: number, current: number) {
  const changes = await ctx.db
    .query("plannerAudit")
    .withIndex("by_plan_and_created_at", (q) => q.eq("planId", planId))
    .order("desc")
    .take(10);
  const since = changes.filter((change) => change.resultRevision > expected).map((change) => change.summary).reverse();
  return `Revision conflict: expected ${expected}, current ${current}.${since.length ? ` Changes since: ${since.join("; ")}.` : ""} Reload planner.get and rebase the command batch.`;
}

export async function commitAudit(ctx: MutationCtx, args: {
  ownerId: Id<"users">;
  planId: Id<"plans">;
  actorType: "user" | "mcp";
  grantId?: Id<"mcpGrants">;
  baseRevision: number;
  resultRevision: number;
  summary: string;
  affectedEntityIds: string[];
  inverseCommands?: InverseCommand[];
}) {
  const auditId = await ctx.db.insert("plannerAudit", {
    ownerId: args.ownerId,
    planId: args.planId,
    actorType: args.actorType,
    grantId: args.grantId,
    createdAt: Date.now(),
    baseRevision: args.baseRevision,
    resultRevision: args.resultRevision,
    summary: args.summary.slice(0, 1_000),
    affectedEntityIds: [...new Set(args.affectedEntityIds)].slice(0, 500),
    undoable: Boolean(args.inverseCommands?.length),
  });
  if (args.inverseCommands?.length) {
    const preferences = args.inverseCommands.some(command => command.type === "preferences.restore")
      ? await ctx.db.query("preferences").withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).unique()
      : null;
    await ctx.db.insert("plannerUndo", {
      auditId,
      ownerId: args.ownerId,
      planId: args.planId,
      inverseCommands: args.inverseCommands,
      preferencesRevision: preferences ? preferences.revision ?? 0 : undefined,
      expiresAt: Date.now() + UNDO_RETENTION_MS,
    });
  }
  return auditId;
}

/** Called by existing browser mutations so every edit participates in revision/audit semantics. */
export async function recordBrowserMutation(ctx: MutationCtx, args: {
  ownerId: Id<"users">;
  planId: Id<"plans">;
  summary: string;
  affectedEntityIds: string[];
  inverseCommands?: InverseCommand[];
}) {
  const plan = await requireOwnedPlan(ctx, args.ownerId, args.planId);
  const baseRevision = planRevision(plan);
  const resultRevision = baseRevision + 1;
  await ctx.db.patch(args.planId, { revision: resultRevision, updatedAt: Date.now() });
  await commitAudit(ctx, { ...args, actorType: "user", baseRevision, resultRevision });
  return resultRevision;
}

export async function findIdempotentResult<T extends Doc<"mcpIdempotency">["result"]>(
  ctx: QueryCtx | MutationCtx,
  grantId: Id<"mcpGrants">,
  key: string,
  operation: string,
): Promise<T | null> {
  if (key.length < 8 || key.length > 200) throw new Error("Idempotency key must be 8–200 characters");
  const row = await ctx.db.query("mcpIdempotency").withIndex("by_grant_and_key", (q) => q.eq("grantId", grantId).eq("key", key)).unique();
  if (!row) return null;
  if (row.operation !== operation) throw new Error("Idempotency key was already used for another operation");
  return row.result as T;
}

export async function storeIdempotentResult(
  ctx: MutationCtx,
  grantId: Id<"mcpGrants">,
  key: string,
  operation: string,
  result: Doc<"mcpIdempotency">["result"],
) {
  await ctx.db.insert("mcpIdempotency", { grantId, key, operation, result, createdAt: Date.now() });
}

export async function undoAudit(ctx: MutationCtx, args: {
  ownerId: Id<"users">;
  grantId: Id<"mcpGrants">;
  planId: Id<"plans">;
  auditId: Id<"plannerAudit">;
  expectedRevision: number;
}) {
  const plan = await requireOwnedPlan(ctx, args.ownerId, args.planId);
  const current = planRevision(plan);
  if (current !== args.expectedRevision) throw new Error(await revisionConflictMessage(ctx, args.planId, args.expectedRevision, current));
  const audit = await ctx.db.get(args.auditId);
  if (!audit || audit.ownerId !== args.ownerId || audit.planId !== args.planId || !audit.undoable) throw new Error("Audit entry is not eligible for undo");
  const undo = await ctx.db.query("plannerUndo").withIndex("by_audit", (q) => q.eq("auditId", audit._id)).unique();
  if (!undo || undo.usedAt !== undefined || undo.expiresAt <= Date.now()) throw new Error("Undo data is missing, expired, or already used");
  if (audit.resultRevision !== current) {
    throw new Error("Only the latest transaction can be undone. Later edits must be preserved; use a new command batch instead.");
  }
  if (undo.preferencesRevision !== undefined) {
    const preferences = await ctx.db.query("preferences").withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).unique();
    if ((preferences?.revision ?? 0) !== undo.preferencesRevision) throw new Error("Scheduling preferences changed after this transaction; undo would overwrite later edits");
  }
  await executeInverseCommands(ctx, args.ownerId, args.planId, undo.inverseCommands);
  if (undo.inverseCommands.some(command => command.type === "preferences.restore")) {
    await recordOtherPreferenceChanges(ctx, { ownerId: args.ownerId, planId: args.planId, actorType: "mcp", grantId: args.grantId });
  }
  const resultRevision = current + 1;
  await ctx.db.patch(args.planId, { revision: resultRevision, updatedAt: Date.now() });
  await ctx.db.patch(undo._id, { usedAt: Date.now() });
  const undoAuditId = await commitAudit(ctx, {
    ownerId: args.ownerId,
    planId: args.planId,
    actorType: "mcp",
    grantId: args.grantId,
    baseRevision: current,
    resultRevision,
    summary: `Undid: ${audit.summary}`,
    affectedEntityIds: audit.affectedEntityIds,
  });
  return { revision: resultRevision, auditId: undoAuditId, summary: `Undid: ${audit.summary}` };
}

export const retentionPolicy = {
  auditSummaryDays: 90,
  undoDays: UNDO_RETENTION_MS / 86_400_000,
  idempotencyHours: IDEMPOTENCY_RETENTION_MS / 3_600_000,
} as const;

/** Account scheduling preferences are part of every plan snapshot. */
export async function recordOtherPreferenceChanges(ctx: MutationCtx, args: {
  ownerId: Id<"users">; planId?: Id<"plans">; actorType: "user" | "mcp"; grantId?: Id<"mcpGrants">;
}) {
  const plans = await ctx.db.query("plans").withIndex("by_owner", q => q.eq("ownerId", args.ownerId)).collect();
  for (const plan of plans) {
    if (plan._id === args.planId) continue;
    const baseRevision = planRevision(plan);
    await ctx.db.patch(plan._id, { revision: baseRevision + 1, updatedAt: Date.now() });
    await commitAudit(ctx, { ...args, planId: plan._id, baseRevision, resultRevision: baseRevision + 1, summary: "Updated account scheduling preferences", affectedEntityIds: [plan._id] });
  }
}
