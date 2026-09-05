import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { api } from "../../convex/_generated/api";
import { convexServerClient } from "./oauth";
import { MCP_GUIDE, MCP_SERVER_INSTRUCTIONS } from "./guide";

type ServerIdentity = { tokenDigest: string; issuer: string; resource: string };

const id = (description: string) => z.string().min(1).max(200).describe(description);
const ref = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/).describe("Document-local reference, unique within this command document");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Real calendar date in YYYY-MM-DD form, interpreted in the account timezone");
const color = z.enum(["coral", "tangerine", "gold", "lime", "chartreuse", "jade", "turquoise", "violet", "orchid", "rose"]);
const unit = z.enum(["slides", "pages", "cards", "videos", "hours", "items"]);
const topicStatus = z.enum(["planned", "active", "done"]);
const priority = z.enum(["low", "normal", "high"]);
const examKind = z.enum(["exam", "deadline", "presentation", "other"]);
const examStatus = z.enum(["confirmed", "provisional"]);
const notes = z.string().max(20_000);
const idempotencyKey = z.string().min(8).max(200).describe("Stable caller-generated key unique to this mutation; reuse only to retry the identical operation");

const courseInput = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(64).optional(),
  notes: notes.optional(),
  color,
});
const examInput = z.object({
  name: z.string().trim().min(1).max(200),
  kind: examKind.optional().default("exam"),
  startDate: date,
  endDate: date.optional().describe("Far end of a provisional date window"),
  status: examStatus.optional(),
  notes: notes.optional(),
});
const topicInput = z.object({
  name: z.string().trim().min(1).max(200),
  unit: unit.optional().default("slides"),
  totalUnits: z.number().nonnegative().max(1_000_000_000).optional().default(0),
  priority: priority.optional().default("normal"),
  notes: notes.optional(),
  color,
});
const preferences = z.object({
  dailyCapacityUnits: z.number().nonnegative().max(1_000_000_000).optional(),
  studyDaysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).describe("Distinct weekdays; 0 is Sunday"),
  blackoutDates: z.array(date).max(2_000),
  theme: z.enum(["system", "light", "dark"]),
  accentColor: z.string().trim().min(1).max(64),
  timezone: z.string().max(100).optional().describe("IANA timezone such as Europe/Berlin"),
});

export const plannerCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plan.update"), patch: z.object({ name: z.string().trim().min(1).max(200).optional(), notes: notes.optional() }) }),
  z.object({ type: z.literal("course.create"), ref, input: courseInput }),
  z.object({ type: z.literal("course.update"), courseId: id("Existing course ID or earlier course ref"), patch: courseInput.partial() }),
  z.object({ type: z.literal("exam.create"), courseId: id("Owning course ID or earlier course ref"), ref, input: examInput }),
  z.object({ type: z.literal("exam.update"), examId: id("Existing exam ID or earlier exam ref"), patch: examInput.partial() }),
  z.object({ type: z.literal("topic.create"), courseId: id("Owning course ID or earlier course ref"), ref, input: topicInput }),
  z.object({
    type: z.literal("topic.update"),
    topicId: id("Existing topic ID or earlier topic ref"),
    patch: z.object({
      name: z.string().trim().min(1).max(200).optional(), unit: unit.optional(), totalUnits: z.number().nonnegative().max(1_000_000_000).optional(), completedUnits: z.number().nonnegative().max(1_000_000_000).optional(), status: topicStatus.optional(), priority: priority.optional(), notes: notes.optional(), color: color.optional(),
    }),
  }),
  z.object({ type: z.literal("topic.reorder"), courseId: id("Course ID or ref"), topicIds: z.array(id("Topic ID or ref")).max(500).describe("Every topic in the course, exactly once, in the desired order") }),
  z.object({ type: z.literal("topic.dependencies.set"), topicId: id("Topic ID or ref"), dependencyIds: z.array(id("Topic ID or ref in the same course")).max(500) }),
  z.object({ type: z.literal("block.create"), topicId: id("Owning topic ID or ref"), ref, input: z.object({ startDate: date, endDate: date, plannedUnits: z.number().nonnegative().max(1_000_000_000).optional(), source: z.enum(["manual", "auto"]).optional().default("manual") }) }),
  z.object({ type: z.literal("block.move"), blockId: id("Study block ID or ref"), startDate: date, endDate: date }),
  z.object({ type: z.literal("block.resize"), blockId: id("Study block ID or ref"), endDate: date, plannedUnits: z.number().nonnegative().max(1_000_000_000).optional() }),
  z.object({ type: z.literal("schedule.regenerate"), today: date, courseIds: z.array(id("Course ID in this plan")).max(50).optional().describe("Omit to regenerate the full plan") }),
  z.object({ type: z.literal("preferences.update"), patch: preferences }),
]);

const mutationOutput = {
  revision: z.number().int().nonnegative(),
  auditId: z.string(),
  summary: z.string(),
  warnings: z.array(z.string()).optional(),
  affectedEntityIds: z.array(z.string()).optional(),
  createdIds: z.record(z.string(), z.string()).optional(),
};

function args(identity: ServerIdentity) {
  return identity;
}

function toolResult(result: Record<string, unknown>, summary: string) {
  return { content: [{ type: "text" as const, text: summary }], structuredContent: result };
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message.replace(/^\[CONVEX[^\]]*\]\s*/, "") : String(cause);
}

async function callTool<T extends Record<string, unknown>>(work: () => Promise<T>, summarize: (result: T) => string) {
  try {
    const result = await work();
    return toolResult(result, summarize(result));
  } catch (cause) {
    throw new Error(errorMessage(cause));
  }
}

type CompletePlan = z.infer<typeof completePlanSchema>;
const completePlanSchema = z.object({
  name: z.string().trim().min(1).max(200),
  notes: notes.optional(),
  courses: z.array(z.object({
    ref,
    ...courseInput.shape,
    exams: z.array(z.object({ ref, ...examInput.shape })).max(250).default([]),
    topics: z.array(z.object({
      ref,
      ...topicInput.shape,
      dependencyRefs: z.array(ref).max(500).default([]),
      blocks: z.array(z.object({ ref, startDate: date, endDate: date, plannedUnits: z.number().nonnegative().max(1_000_000_000).optional(), source: z.enum(["manual", "auto"]).optional().default("manual") })).max(500).default([]),
    })).max(500),
  })).min(1).max(100),
  generateInitialSchedule: z.boolean().default(false),
  today: date.optional().describe("Required when generateInitialSchedule is true"),
});

function completePlanCommands(plan: CompletePlan): z.infer<typeof plannerCommandSchema>[] {
  if (plan.generateInitialSchedule && !plan.today) throw new Error("today is required when generateInitialSchedule is true");
  const commands: z.infer<typeof plannerCommandSchema>[] = [];
  for (const course of plan.courses) {
    commands.push({ type: "course.create", ref: course.ref, input: { name: course.name, code: course.code, notes: course.notes, color: course.color } });
    for (const exam of course.exams) commands.push({ type: "exam.create", courseId: course.ref, ref: exam.ref, input: { name: exam.name, kind: exam.kind, startDate: exam.startDate, endDate: exam.endDate, status: exam.status, notes: exam.notes } });
    for (const topic of course.topics) commands.push({ type: "topic.create", courseId: course.ref, ref: topic.ref, input: { name: topic.name, unit: topic.unit, totalUnits: topic.totalUnits, priority: topic.priority, notes: topic.notes, color: topic.color } });
  }
  for (const course of plan.courses) {
    for (const topic of course.topics) {
      if (topic.dependencyRefs.length) commands.push({ type: "topic.dependencies.set", topicId: topic.ref, dependencyIds: topic.dependencyRefs });
      for (const block of topic.blocks) commands.push({ type: "block.create", topicId: topic.ref, ref: block.ref, input: { startDate: block.startDate, endDate: block.endDate, plannedUnits: block.plannedUnits, source: block.source } });
    }
  }
  if (plan.generateInitialSchedule) commands.push({ type: "schedule.regenerate", today: plan.today! });
  if (commands.length > 100) throw new Error("Complete plan expands beyond the 100-command transaction limit; split the plan");
  return commands;
}

export function createPlannerMcpServer(identity: ServerIdentity) {
  const client = convexServerClient();
  const server = new McpServer(
    { name: "study-planner", version: "1.0.0" },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  );

  server.registerResource(
    "study-planner-guide",
    "study-planner://guide",
    { title: "Study Planner domain and safe-workflow guide", description: "Planner hierarchy, scheduling semantics, revisions, retries, audit, and unavailable operations", mimeType: "text/markdown" },
    async () => ({ contents: [{ uri: "study-planner://guide", mimeType: "text/markdown", text: MCP_GUIDE }] }),
  );

  server.registerTool("planner.list", {
    title: "List study plans",
    description: "List up to 50 plans with revisions, sizes, and upcoming deadlines so you can choose a target.",
    inputSchema: { today: date.optional().describe("Optional lower bound for upcoming deadlines") },
    outputSchema: {
      plans: z.array(z.object({ planId: z.string(), name: z.string(), revision: z.number(), courseCount: z.number(), topicCount: z.number(), upcomingDeadlines: z.array(z.unknown()), updatedAt: z.number() })),
      limit: z.number(), hasMore: z.boolean(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ today }) => callTool(() => client.query(api.mcpPlanner.listPlans, { ...args(identity), today }), (result) => `Found ${result.plans.length} study plan${result.plans.length === 1 ? "" : "s"}.`));

  server.registerTool("planner.get", {
    title: "Get a complete study plan",
    description: "Read one plan's courses, exams, topics, dependencies, blocks, preferences, timezone, revision, and optionally its latest 500 progress records.",
    inputSchema: { planId: id("Plan ID returned by planner.list"), includeStudyLog: z.boolean().optional().default(true) },
    outputSchema: { plan: z.record(z.string(), z.unknown()), preferences: z.record(z.string(), z.unknown()), timezone: z.string(), studyLog: z.array(z.unknown()), limits: z.record(z.string(), z.unknown()) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ planId, includeStudyLog }) => callTool(() => client.query(api.mcpPlanner.getPlan, { ...args(identity), planId: planId as never, includeStudyLog }), (result) => `Loaded ${String((result.plan as { name?: string }).name ?? "plan")} at revision ${String((result.plan as { revision?: number }).revision ?? "unknown")}.`));

  server.registerTool("planner.create", {
    title: "Create a complete study plan",
    description: "Atomically create one complete multi-course plan using document-local refs; optionally generate its first deterministic schedule.",
    inputSchema: { idempotencyKey, plan: completePlanSchema },
    outputSchema: { planId: z.string(), ...mutationOutput },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ idempotencyKey, plan }) => callTool(() => client.mutation(api.mcpPlanner.createPlan, { ...args(identity), idempotencyKey, name: plan.name, notes: plan.notes, commands: completePlanCommands(plan) }), (result) => result.summary));

  server.registerTool("planner.preview_changes", {
    title: "Preview plan changes",
    description: "Validate a bounded command batch and calculate deterministic scheduling effects without writing anything.",
    inputSchema: { planId: id("Target plan ID"), commands: z.array(plannerCommandSchema).min(1).max(100) },
    outputSchema: { revision: z.number(), resultingRevision: z.number(), summary: z.string(), warnings: z.array(z.string()), generatedBlocks: z.array(z.unknown()), writesApplied: z.literal(false) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ planId, commands }) => callTool(() => client.query(api.mcpPlanner.previewChanges, { ...args(identity), planId: planId as never, commands }), (result) => `${result.summary}. No writes applied${result.warnings.length ? `; ${result.warnings.length} warning(s)` : ""}.`));

  server.registerTool("planner.apply_changes", {
    title: "Apply plan changes",
    description: "Atomically apply an explicit validated command batch. Requires the revision last read and a stable idempotency key; stale writes are rejected.",
    inputSchema: { planId: id("Target plan ID"), expectedRevision: z.number().int().nonnegative(), idempotencyKey, commands: z.array(plannerCommandSchema).min(1).max(100) },
    outputSchema: mutationOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ planId, expectedRevision, idempotencyKey, commands }) => callTool(() => client.mutation(api.mcpPlanner.applyChanges, { ...args(identity), planId: planId as never, expectedRevision, idempotencyKey, commands }), (result) => `${result.summary}. Plan is now revision ${result.revision}.`));

  server.registerTool("planner.record_progress", {
    title: "Record study progress",
    description: "Atomically append or correct a bounded progress entry and update the topic's completion/status with revision and idempotency checks.",
    inputSchema: { planId: id("Owning plan ID"), topicId: id("Topic ID in the plan"), expectedRevision: z.number().int().nonnegative(), idempotencyKey, date, units: z.number().min(-1_000_000_000).max(1_000_000_000).describe("Positive to record progress; negative to correct it"), minutes: z.number().int().nonnegative().max(10_080).optional(), note: z.string().max(4_000).optional() },
    outputSchema: { revision: z.number(), auditId: z.string(), logId: z.string(), topicId: z.string(), completedUnits: z.number(), status: topicStatus, summary: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ planId, topicId, expectedRevision, idempotencyKey, date, units, minutes, note }) => callTool(() => client.mutation(api.mcpPlanner.recordProgress, { ...args(identity), planId: planId as never, topicId: topicId as never, expectedRevision, idempotencyKey, date, units, minutes, note }), (result) => `${result.summary}. Topic is ${result.status}; plan revision ${result.revision}.`));

  server.registerTool("planner.history", {
    title: "Read plan change history",
    description: "Read 1–50 recent payload-free transaction summaries. Pass nextCursor as before to continue.",
    inputSchema: { planId: id("Target plan ID"), limit: z.number().int().min(1).max(50).optional().default(20), before: z.number().optional().describe("Cursor returned by the previous page") },
    outputSchema: { changes: z.array(z.object({ auditId: z.string(), createdAt: z.number(), actorType: z.enum(["user", "mcp"]), baseRevision: z.number(), resultRevision: z.number(), summary: z.string(), affectedEntityIds: z.array(z.string()), undoable: z.boolean() })), nextCursor: z.number().nullable() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ planId, limit, before }) => callTool(() => client.query(api.mcpPlanner.history, { ...args(identity), planId: planId as never, limit, before }), (result) => `Returned ${result.changes.length} change summaries.`));

  server.registerTool("planner.undo", {
    title: "Undo a plan transaction",
    description: "Reverse one eligible unexpired transaction, only when the plan is still at expectedRevision. The undo is itself audited.",
    inputSchema: { planId: id("Target plan ID"), auditId: id("Undoable audit ID from planner.history"), expectedRevision: z.number().int().nonnegative(), idempotencyKey },
    outputSchema: { revision: z.number(), auditId: z.string(), summary: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, ({ planId, auditId, expectedRevision, idempotencyKey }) => callTool(() => client.mutation(api.mcpPlanner.undo, { ...args(identity), planId: planId as never, auditId: auditId as never, expectedRevision, idempotencyKey }), (result) => `${result.summary}. Plan is now revision ${result.revision}.`));

  return server;
}
