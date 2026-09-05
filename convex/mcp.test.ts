import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

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
    codeChallenge: "v".repeat(43),
    codeDigest: "c".repeat(43),
    timezone: "Europe/Berlin",
  });
  await t.mutation(api.mcpOAuth.exchangeAuthorizationCode, {
    codeDigest: "c".repeat(43),
    verifierChallenge: "v".repeat(43),
    clientId,
    redirectUri: "https://client.example/callback",
    resource,
    issuer,
    accessTokenDigest: "a".repeat(43),
    refreshTokenDigest: "r".repeat(43),
  });
  return { tokenDigest: "a".repeat(43), issuer, resource };
}

describe("OAuth-protected MCP planner", () => {
  it("enforces PKCE, audience, refresh rotation, and immediate grant revocation", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) => ctx.db.insert("users", { name: "Alice" }));
    const identity = await connect(t, ownerId);

    await expect(
      t.mutation(api.mcpOAuth.authenticateAccess, {
        ...identity,
        requiredScopes: ["planner:read"],
      }),
    ).resolves.toMatchObject({ ownerId, scopes: ["planner:read", "planner:manage"] });

    await expect(
      t.mutation(api.mcpOAuth.authenticateAccess, {
        ...identity,
        resource: "https://other.example/mcp",
        requiredScopes: ["planner:read"],
      }),
    ).rejects.toThrow("wrong-audience");

    await t.mutation(api.mcpOAuth.refreshAccessToken, {
      refreshTokenDigest: "r".repeat(43),
      clientId,
      resource,
      issuer,
      accessTokenDigest: "n".repeat(43),
      nextRefreshTokenDigest: "s".repeat(43),
    });
    await expect(
      t.mutation(api.mcpOAuth.authenticateAccess, {
        tokenDigest: "a".repeat(43),
        issuer,
        resource,
        requiredScopes: ["planner:read"],
      }),
    ).rejects.toThrow("Invalid");

    const owner = t.withIdentity({ subject: ownerId });
    const [connection] = await owner.query(api.mcpOAuth.listConnections, {});
    await owner.mutation(api.mcpOAuth.revokeConnection, { grantId: connection.grantId });
    await expect(
      t.mutation(api.mcpOAuth.authenticateAccess, {
        tokenDigest: "n".repeat(43),
        issuer,
        resource,
        requiredScopes: ["planner:read"],
      }),
    ).rejects.toThrow("revoked");
  });

  it("creates atomically, previews without writes, rejects stale edits, retries safely, audits, and undoes", async () => {
    const t = convexTest(schema, modules);
    const [aliceId, bobId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", { name: "Alice" }),
      await ctx.db.insert("users", { name: "Bob" }),
    ]);
    const identity = await connect(t, aliceId);
    const bobPlanId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        ownerId: bobId,
        name: "Bob plan",
        notes: "",
        revision: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );

    const created = await t.mutation(api.mcpPlanner.createPlan, {
      ...identity,
      idempotencyKey: "create-plan-1",
      name: "Alice semester",
      commands: [
        { type: "course.create", ref: "biology", input: { name: "Biology", color: "violet" } },
        { type: "exam.create", courseId: "biology", ref: "final", input: { name: "Final", startDate: "2026-12-10" } },
        { type: "topic.create", courseId: "biology", ref: "cells", input: { name: "Cells", totalUnits: 40, color: "violet" } },
        { type: "block.create", topicId: "cells", ref: "manual", input: { startDate: "2026-09-08", endDate: "2026-09-08", plannedUnits: 10, source: "manual" } },
      ],
    });
    expect(created.revision).toBe(1);
    expect(created.createdIds).toMatchObject({ biology: expect.any(String), cells: expect.any(String) });

    await expect(
      t.query(api.mcpPlanner.getPlan, { ...identity, planId: bobPlanId }),
    ).rejects.toThrow("Plan not found");

    const preview = await t.query(api.mcpPlanner.previewChanges, {
      ...identity,
      planId: created.planId,
      commands: [{ type: "plan.update", patch: { name: "Preview only" } }],
    });
    expect(preview).toMatchObject({ revision: 1, resultingRevision: 2, writesApplied: false });
    expect((await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId })).plan.name).toBe("Alice semester");

    const applied = await t.mutation(api.mcpPlanner.applyChanges, {
      ...identity,
      planId: created.planId,
      expectedRevision: 1,
      idempotencyKey: "rename-plan-1",
      commands: [{ type: "plan.update", patch: { name: "Exam season" } }],
    });
    expect(applied).toMatchObject({ revision: 2, auditId: expect.any(String) });
    expect(
      await t.mutation(api.mcpPlanner.applyChanges, {
        ...identity,
        planId: created.planId,
        expectedRevision: 1,
        idempotencyKey: "rename-plan-1",
        commands: [{ type: "plan.update", patch: { name: "Exam season" } }],
      }),
    ).toEqual(applied);

    await expect(
      t.mutation(api.mcpPlanner.applyChanges, {
        ...identity,
        planId: created.planId,
        expectedRevision: 1,
        idempotencyKey: "stale-edit-1",
        commands: [{ type: "plan.update", patch: { name: "Stale" } }],
      }),
    ).rejects.toThrow("Revision conflict");

    const history = await t.query(api.mcpPlanner.history, { ...identity, planId: created.planId, limit: 10 });
    expect(history.changes[0]).toMatchObject({ actorType: "mcp", resultRevision: 2, undoable: true });
    const undone = await t.mutation(api.mcpPlanner.undo, {
      ...identity,
      planId: created.planId,
      auditId: applied.auditId,
      expectedRevision: 2,
      idempotencyKey: "undo-rename-1",
    });
    expect(undone.revision).toBe(3);
    expect((await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId })).plan.name).toBe("Alice semester");

    const progressUpdate = await t.mutation(api.mcpPlanner.applyChanges, {
      ...identity,
      planId: created.planId,
      expectedRevision: 3,
      idempotencyKey: "partial-progress-1",
      commands: [{ type: "topic.update", topicId: created.createdIds.cells, patch: { completedUnits: 5 } }],
    });
    expect(progressUpdate.revision).toBe(4);
    const updated = await t.query(api.mcpPlanner.getPlan, { ...identity, planId: created.planId });
    expect(updated.plan.courses[0].topics[0].completedUnits).toBe(5);
  });
});
