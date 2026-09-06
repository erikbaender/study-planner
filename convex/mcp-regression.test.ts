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
