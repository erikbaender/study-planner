import { createHash, randomBytes } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { sha256Base64url } from "./mcpOAuth";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./_generated/*.js"),
};

const issuer = "https://planner.example";
const resource = `${issuer}/mcp`;
const clientId = "mcp_client_test_123456789";

async function connect(t: ReturnType<typeof convexTest>, ownerId: string) {
  await t.mutation(api.mcpOAuth.registerClient, {
    clientId,
    name: "Test MCP client",
    redirectUris: ["https://client.example/callback"],
  });
  const owner = t.withIdentity({ subject: ownerId });
  await owner.mutation(api.mcpOAuth.authorize, {
    clientId,
    redirectUri: "https://client.example/callback",
    resource,
    issuer,
    scopes: ["planner:read", "planner:manage"],
    codeChallenge: await sha256Base64url("v".repeat(43)),
    codeDigest: "c".repeat(43),
    timezone: "Europe/Berlin",
  });
  await t.mutation(api.mcpOAuth.exchangeAuthorizationCode, {
    codeDigest: "c".repeat(43),
    codeVerifier: "v".repeat(43),
    clientId,
    redirectUri: "https://client.example/callback",
    resource,
    issuer,
    accessTokenDigest: "a".repeat(43),
    refreshTokenDigest: "r".repeat(43),
  });
  return { tokenDigest: "a".repeat(43), issuer, resource };
}


async function setup() {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(ctx => ctx.db.insert("users", { name: "Alice" }));
  const identity = await connect(t, ownerId);
  const owner = t.withIdentity({ subject: ownerId });
  const created = await t.mutation(api.mcpPlanner.createPlan, {
    ...identity, idempotencyKey: "create-review-plan", name: "Original", notes: "Original notes",
    commands: [
      { type: "course.create", ref: "course", input: { name: "Biology", color: "violet" } },
      { type: "exam.create", ref: "exam", courseId: "course", input: { name: "Final", startDate: "2026-12-10" } },
      { type: "topic.create", ref: "topic", courseId: "course", input: { name: "Cells", totalUnits: 40, color: "violet" } },
    ],
  });
  return { t, owner, identity, created };
}

describe("MCP security and transaction regressions", () => {
  it("records only effective progress deltas for MCP and browser writes, including idempotent retries", async () => {
    const { t, owner, identity, created } = await setup();
    const topicId = created.createdIds.topic as never;
    const record = { ...identity, planId: created.planId, topicId, expectedRevision: 1, idempotencyKey: "bounded-over-completion", date: "2026-09-05", units: 1000 };
    const first = await t.mutation(api.mcpPlanner.recordProgress, record);
    expect(first).toMatchObject({ completedUnits: 40, appliedUnits: 40, requestedUnits: 1000 });
    expect(await t.mutation(api.mcpPlanner.recordProgress, record)).toEqual(first);
    const correction = await t.mutation(api.mcpPlanner.recordProgress, { ...record, expectedRevision: 2, idempotencyKey: "bounded-correction", units: -1000 });
    expect(correction).toMatchObject({ completedUnits: 0, appliedUnits: -40 });
    await owner.mutation(api.planner.logStudy, { topicId, date: "2026-09-05", units: -1000, expectedRevisions: { [created.planId]: 3 } });
    await owner.mutation(api.planner.logStudy, { topicId, date: "2026-09-05", units: 1000, expectedRevisions: { [created.planId]: 4 } });
    const logs = await owner.query(api.planner.listStudyLog, {});
    expect(logs.map(log => log.units).sort((a,b) => a-b)).toEqual([-40, 0, 40, 40]);
    const snapshot = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    expect(logs.reduce((sum, log) => sum + log.units, 0)).toBe(snapshot.plan.courses[0].topics[0].completedUnits);
  });

  it("preserves omitted preferences, honors zero capacity and rejects inconsistent completion", async () => {
    const { t, identity, created } = await setup();
    await t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "set-calendar-preferences", commands: [{ type: "preferences.update", patch: { studyDaysOfWeek: [1, 3], blackoutDates: ["2026-09-09"], theme: "dark", accentColor: "violet", timezone: "Europe/Berlin" } }] });
    const result = await t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 2, idempotencyKey: "zero-capacity-preferences", commands: [{ type: "preferences.update", patch: { dailyCapacityUnits: 0 } }, { type: "schedule.regenerate", today: "2026-09-05" }] });
    expect(result.warnings.length).toBeGreaterThan(0);
    const snapshot = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    expect(snapshot.preferences).toMatchObject({ dailyCapacityUnits: 0, studyDaysOfWeek: [1, 3], blackoutDates: ["2026-09-09"], theme: "dark", accentColor: "violet" });
    expect(snapshot.timezone).toBe("Europe/Berlin");
    expect(snapshot.plan.courses[0].topics[0].blocks).toHaveLength(0);
    await expect(t.query(api.mcpPlanner.previewChanges, { ...identity, planId: created.planId, commands: [{ type: "topic.update", topicId: created.createdIds.topic, patch: { status: "done" } }] })).rejects.toThrow("completedUnits equal to totalUnits");
    await expect(t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 3, idempotencyKey: "reject-inconsistent-done", commands: [{ type: "topic.update", topicId: created.createdIds.topic, patch: { status: "done", completedUnits: 0 } }] })).rejects.toThrow("completedUnits equal to totalUnits");
  });

  it("public exchange rejects the observed challenge as a substitute for the secret verifier", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run(ctx => ctx.db.insert("users", { name: "Alice" }));
    await t.mutation(api.mcpOAuth.registerClient, { clientId, name: "Client", redirectUris: ["https://client.example/callback"] });
    const digest = (s: string) => createHash("sha256").update(s).digest("base64url");
    const observedChallenge = digest(randomBytes(32).toString("base64url"));
    const observedCode = randomBytes(32).toString("base64url");
    await t.withIdentity({ subject: ownerId }).mutation(api.mcpOAuth.authorize, {
      clientId, redirectUri: "https://client.example/callback", resource, issuer,
      scopes: ["planner:read", "planner:manage"], codeChallenge: observedChallenge, codeDigest: digest(observedCode),
    });
    const attackerToken = randomBytes(32).toString("base64url");
    await expect(t.mutation(api.mcpOAuth.exchangeAuthorizationCode, {
      codeDigest: digest(observedCode), codeVerifier: observedChallenge,
      clientId, redirectUri: "https://client.example/callback", resource, issuer,
      accessTokenDigest: digest(attackerToken), refreshTokenDigest: digest("attacker refresh token"),
    })).rejects.toThrow("PKCE");
    await expect(t.mutation(api.mcpOAuth.authenticateAccess, {
      tokenDigest: digest(attackerToken), resource, issuer, requiredScopes: ["planner:manage"],
    })).rejects.toThrow("Invalid");
  });

  it("preview evaluates preceding progress changes before scheduling", async () => {
    const { t, identity, created } = await setup();
    const commands = [
      { type: "topic.update" as const, topicId: created.createdIds.topic, patch: { completedUnits: 40, status: "done" as const } },
      { type: "schedule.regenerate" as const, today: "2026-09-05" },
    ];
    const preview = await t.query(api.mcpPlanner.previewChanges, { ...identity, planId: created.planId, commands });
    expect(preview.generatedBlocks).toHaveLength(0);
    await t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "apply-preview-commands", commands });
    const actual = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    expect(actual.plan.courses[0].topics[0].blocks).toHaveLength(0);
  });

  it("undo rejects historical transactions and preserves later browser edits", async () => {
    const { t, owner, identity, created } = await setup();
    const applied = await t.mutation(api.mcpPlanner.applyChanges, {
      ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "rename-review-plan",
      commands: [{ type: "plan.update", patch: { name: "Renamed" } }],
    });
    await owner.mutation(api.planner.updatePlan, { planId: created.planId, expectedRevisions: { [created.planId]: 2 }, name: "Renamed", notes: "Later browser notes" });
    await expect(t.mutation(api.mcpPlanner.undo, {
      ...identity, planId: created.planId, auditId: applied.auditId, expectedRevision: 3, idempotencyKey: "undo-review-plan",
    })).rejects.toThrow("latest transaction");
    const actual = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    expect(actual.plan.notes).toBe("Later browser notes");
  });

  it("a stale browser save rejects an intervening MCP edit", async () => {
    const { t, owner, identity, created } = await setup();
    await t.mutation(api.mcpPlanner.applyChanges, {
      ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "mcp-rename-review",
      commands: [{ type: "plan.update", patch: { name: "Agent changed name" } }],
    });
    await expect(owner.mutation(api.planner.updatePlan, { planId: created.planId, expectedRevisions: { [created.planId]: 1 }, name: "Original", notes: "Browser changed notes" })).rejects.toThrow("Revision conflict");
    const actual = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    expect(actual.plan.name).toBe("Agent changed name");
    expect(actual.plan.revision).toBe(2);
  });
});

describe("Command evaluator parity and recovery", () => {
  it("preview validates local refs and generates the same new-course schedule as apply", async () => {
    const { t, identity, created } = await setup();
    const commands = [
      { type: "course.create" as const, ref: "newCourse", input: { name: "Chemistry", color: "violet" } },
      { type: "topic.create" as const, courseId: "newCourse", ref: "newTopic", input: { name: "Bonds", color: "violet", totalUnits: 10 } },
      { type: "exam.create" as const, courseId: "newCourse", ref: "newExam", input: { name: "Final", startDate: "2026-09-20" } },
      { type: "schedule.regenerate" as const, courseIds: ["newCourse"], today: "2026-09-05" },
    ];
    const before = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    const preview = await t.query(api.mcpPlanner.previewChanges, { ...identity, planId: created.planId, commands });
    expect(await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId })).toEqual(before);
    const applied = await t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "new-course-schedule", commands });
    const after = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    const blocks = after.plan.courses.find(course => course.id === applied.createdIds.newCourse)!.topics[0].blocks;
    expect(preview.generatedBlocks.map(({ startDate, endDate, plannedUnits }) => ({ startDate, endDate, plannedUnits })))
      .toEqual(blocks.map(({ startDate, endDate, plannedUnits }) => ({ startDate, endDate, plannedUnits })));
  });

  it("preview and apply reject invalid progress and atomically roll back earlier commands", async () => {
    const { t, identity, created } = await setup();
    const commands = [
      { type: "plan.update" as const, patch: { name: "Must roll back" } },
      { type: "topic.update" as const, topicId: created.createdIds.topic, patch: { completedUnits: 41 } },
    ];
    await expect(t.query(api.mcpPlanner.previewChanges, { ...identity, planId: created.planId, commands })).rejects.toThrow();
    await expect(t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "invalid-progress-batch", commands })).rejects.toThrow();
    expect((await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId })).plan).toMatchObject({ name: "Original", revision: 1 });
    expect((await t.query(api.mcpPlanner.history, { ...identity, planId: created.planId })).changes).toHaveLength(1);
  });

  it("a browser-moved generated block remains manual after MCP regeneration", async () => {
    const { t, owner, identity, created } = await setup();
    const applied = await t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "initial-reflow", commands: [{ type: "schedule.regenerate", today: "2026-09-05" }] });
    const before = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    const block = before.plan.courses[0].topics[0].blocks[0];
    await owner.mutation(api.planner.updateStudyBlocks, { expectedRevisions: { [created.planId]: applied.revision }, updates: [{ blockId: block.id as never, startDate: "2026-09-08", endDate: "2026-09-08", plannedUnits: block.plannedUnits }] });
    await t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 3, idempotencyKey: "second-reflow", commands: [{ type: "schedule.regenerate", today: "2026-09-05" }] });
    const after = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    expect(after.plan.courses[0].topics[0].blocks.find(candidate => candidate.id === block.id)).toMatchObject({ startDate: "2026-09-08", source: "manual" });
  });

  it("requires a browser revision and allows undo of the latest browser command", async () => {
    const { t, owner, identity, created } = await setup();
    await expect(owner.mutation(api.planner.updatePlan, { planId: created.planId, name: "Missing", notes: "" })).rejects.toThrow("revision is required");
    await owner.mutation(api.planner.updatePlan, { planId: created.planId, expectedRevisions: { [created.planId]: 1 }, name: "Browser", notes: "Original notes" });
    const history = await t.query(api.mcpPlanner.history, { ...identity, planId: created.planId });
    expect(history.changes[0]).toMatchObject({ actorType: "user", undoable: true });
    await t.mutation(api.mcpPlanner.undo, { ...identity, planId: created.planId, expectedRevision: 2, auditId: history.changes[0].auditId, idempotencyKey: "undo-browser-rename" });
    expect((await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId })).plan.name).toBe("Original");
  });

  it("authorization timezone remains readable by the browser's strict return validator", async () => {
    const { owner } = await setup();
    expect(await owner.query(api.planner.getPreferences, {})).toMatchObject({ timezone: "Europe/Berlin" });
  });
});

it("lets the account owner review and undo an agent edit with browser revision and actor safeguards", async () => {
  const { t, owner, identity, created } = await setup();
  const result = await t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "history-browser-edit", commands: [{ type: "plan.update", patch: { name: "Agent renamed" } }] });
  const changes = await owner.query(api.planner.recentChanges, { planId: created.planId, asOf: Date.now() });
  expect(changes.find(change => change.id === result.auditId)).toMatchObject({ actor: "Test MCP client", canUndo: true, summary: "Updated plan details" });
  expect(changes.find(change => change.id === created.auditId)?.canUndo).toBe(false);
  const outsiderId = await t.run(ctx => ctx.db.insert("users", { name: "Other" }));
  const outsider = t.withIdentity({ subject: outsiderId });
  await expect(outsider.query(api.planner.recentChanges, { planId: created.planId, asOf: Date.now() })).rejects.toThrow("Plan not found");
  await expect(owner.mutation(api.planner.undoChange, { planId: created.planId, auditId: result.auditId, expectedRevisions: { [created.planId]: 1 } })).rejects.toThrow("Revision conflict");
  await owner.mutation(api.planner.undoChange, { planId: created.planId, auditId: result.auditId, expectedRevisions: { [created.planId]: 2 } });
  const tree = await owner.query(api.planner.listPlanTrees, {});
  expect(tree[0].name).toBe("Original");
  expect((await owner.query(api.planner.recentChanges, { planId: created.planId, asOf: Date.now() })).find(change => change.summary.startsWith("Undid"))?.actor).toBe("You");
  await expect(owner.mutation(api.planner.undoChange, { planId: created.planId, auditId: result.auditId, expectedRevisions: { [created.planId]: 3 } })).rejects.toThrow("already used");
});

it("corrects dated browser sessions atomically and rejects stale or foreign session edits", async () => {
  const { t, owner, created } = await setup();
  const topicId = created.createdIds.topic as never;
  const logId = await owner.mutation(api.planner.logStudy, { topicId, date: "2026-09-04", units: 10, minutes: 30, note: "Yesterday", expectedRevisions: { [created.planId]: 1 } });
  await owner.mutation(api.planner.updateStudyLog, { logId, date: "2026-09-03", units: 1000, minutes: 45, note: "Corrected", expectedRevisions: { [created.planId]: 2 } });
  expect(await owner.query(api.planner.listStudyLog, {})).toMatchObject([{ date: "2026-09-03", units: 40, minutes: 45, note: "Corrected" }]);
  await expect(owner.mutation(api.planner.updateStudyLog, { logId, date: "2026-09-03", units: 5, expectedRevisions: { [created.planId]: 2 } })).rejects.toThrow("Revision conflict");
  await owner.mutation(api.planner.updateStudyLog, { logId, date: "2026-09-03", units: -1000, expectedRevisions: { [created.planId]: 3 } });
  const logs = await owner.query(api.planner.listStudyLog, {});
  const tree = await owner.query(api.planner.listPlanTrees, {});
  expect(logs[0].units).toBe(0);
  expect(tree[0].courses[0].topics[0].completedUnits).toBe(0);
  const outsiderId = await t.run(ctx => ctx.db.insert("users", { name: "Other" }));
  await expect(t.withIdentity({ subject: outsiderId }).mutation(api.planner.updateStudyLog, { logId, date: "2026-09-03", units: 5, expectedRevisions: {} })).rejects.toThrow("Study session not found");
});

it("round-trips topic throughput through MCP, schedules in minutes, and undoes a first estimate", async () => {
  const { t, owner, identity, created } = await setup();
  const topicId = created.createdIds.topic as never;
  const result = await t.mutation(api.mcpPlanner.applyChanges, { ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "time-estimate-schedule", commands: [{ type: "topic.update", topicId, patch: { minutesPerUnit: 6 } }, { type: "preferences.update", patch: { dailyCapacityMinutes: 120 } }, { type: "schedule.regenerate", today: "2026-09-07" }] });
  const plan = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
  expect(plan.preferences.dailyCapacityMinutes).toBe(120);
  expect(plan.plan.courses[0].topics[0]).toMatchObject({ minutesPerUnit: 6 });
  expect(plan.plan.courses[0].topics[0].blocks).toHaveLength(2);
  expect(plan.plan.courses[0].topics[0].blocks.every(block => block.plannedUnits === 20)).toBe(true);
  await owner.mutation(api.planner.undoChange, { planId: created.planId, auditId: result.auditId, expectedRevisions: { [created.planId]: 2 } });
  const undone = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
  expect(undone.plan.courses[0].topics[0].minutesPerUnit).toBeUndefined();
});

it.each([
  { dailyCapacityUnits: 60 },
  { dailyCapacityMinutes: 90 },
  {},
])("undo restores absent optional preferences from an existing document: %j", async (capacity) => {
  const { t, identity, created } = await setup();
  const original = { ...capacity, studyDaysOfWeek: [1, 3, 5], blackoutDates: ["2026-09-09"], theme: "dark" as const, accentColor: "violet" };
  const preferenceId = await t.run(async ctx => {
    const plan = await ctx.db.get(created.planId);
    const existing = await ctx.db.query("preferences").withIndex("by_owner", q => q.eq("ownerId", plan!.ownerId)).unique();
    if (existing) await ctx.db.delete(existing._id);
    return ctx.db.insert("preferences", { ownerId: plan!.ownerId, ...original, revision: 1, updatedAt: Date.now() });
  });
  const before = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
  const applied = await t.mutation(api.mcpPlanner.applyChanges, {
    ...identity, planId: created.planId, expectedRevision: 1, idempotencyKey: "introduce-optional-preferences",
    commands: [{ type: "preferences.update", patch: { dailyCapacityUnits: 30, dailyCapacityMinutes: 120, timezone: "Europe/Berlin" } }, { type: "schedule.regenerate", today: "2026-09-07" }],
  });
  // Exercise the persisted inverse, where absent properties cannot survive as undefined.
  await t.run(async ctx => {
    const undo = await ctx.db.query("plannerUndo").withIndex("by_audit", q => q.eq("auditId", applied.auditId)).unique();
    await ctx.db.patch(undo!._id, { inverseCommands: JSON.parse(JSON.stringify(undo!.inverseCommands)) });
  });
  await t.mutation(api.mcpPlanner.undo, { ...identity, planId: created.planId, auditId: applied.auditId, expectedRevision: applied.revision, idempotencyKey: "undo-optional-preferences" });
  const after = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
  expect(after.preferences).toEqual(before.preferences);
  expect(after.plan.courses[0].topics[0].blocks).toEqual(before.plan.courses[0].topics[0].blocks);
  const stored = await t.run(ctx => ctx.db.get(preferenceId));
  expect(stored).not.toHaveProperty("timezone");
  if (!("dailyCapacityUnits" in capacity)) expect(stored).not.toHaveProperty("dailyCapacityUnits");
  if (!("dailyCapacityMinutes" in capacity)) expect(stored).not.toHaveProperty("dailyCapacityMinutes");
});

it("expires browser undo display, validates timezones, and preserves bulk throughput", async () => {
  const { t, owner, created } = await setup();
  const prefs = { studyDaysOfWeek: [1], blackoutDates: [], theme: "dark" as const, accentColor: "violet", dailyCapacityMinutes: 120 };
  await expect(owner.mutation(api.planner.savePreferences, { ...prefs, timezone: "Invalid/Zone", expectedRevisions: { [created.planId]: 1 } })).rejects.toThrow("Timezone must be a valid IANA timezone");
  const topicIds = await owner.mutation(api.planner.createTopics, { courseId: created.createdIds.course as never, color: "violet", topics: [{ name: "Reading", unit: "pages", totalUnits: 30, minutesPerUnit: 4 }], expectedRevisions: { [created.planId]: 1 } });
  const tree = await owner.query(api.planner.listPlanTrees, {});
  expect(tree[0].courses[0].topics.find(topic => topic._id === topicIds[0])?.minutesPerUnit).toBe(4);
  const logId = await owner.mutation(api.planner.logStudy, { topicId: topicIds[0], date: "2026-09-01", units: 5, expectedRevisions: { [created.planId]: 2 } });
  const before = await owner.query(api.planner.recentChanges, { planId: created.planId, asOf: Date.now() });
  const latest = before.find(change => change.summary.includes("Recorded progress"))!;
  expect(latest.canUndo).toBe(true);
  const after = await owner.query(api.planner.recentChanges, { planId: created.planId, asOf: Date.now() + 31 * 86400000 });
  expect(after.find(change => change.id === latest.id)?.canUndo).toBe(false);
  await t.run(async ctx => {
    const payload = await ctx.db.query("plannerUndo").withIndex("by_audit", q => q.eq("auditId", latest.id as never)).unique();
    await ctx.db.patch(payload!._id, { expiresAt: Date.now() - 1 });
  });
  await expect(owner.mutation(api.planner.undoChange, { planId: created.planId, auditId: latest.id as never, expectedRevisions: { [created.planId]: 3 } })).rejects.toThrow("expired");
  expect((await owner.query(api.planner.listStudyLog, {}))[0]._id).toBe(logId);
});
