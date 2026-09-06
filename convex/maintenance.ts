import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;
const RATE_LIMIT_RETENTION_MINUTES = 5;
const PRUNE_BATCH_SIZE = 250;

/** Small indexed batches keep retention predictable without creating a large cron transaction. */
export const pruneExpiredMcpData = internalMutation({
  args: {},
  returns: v.object({
    authorizationCodes: v.number(),
    tokens: v.number(),
    auditEntries: v.number(),
    undoRecords: v.number(),
    idempotencyRecords: v.number(),
    rateLimitRecords: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const authorizationCodes = await ctx.db
      .query("oauthAuthorizationCodes")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(PRUNE_BATCH_SIZE);
    const tokens = await ctx.db
      .query("oauthTokens")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(PRUNE_BATCH_SIZE);
    const undoRecords = await ctx.db
      .query("plannerUndo")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(PRUNE_BATCH_SIZE);
    const auditEntries = await ctx.db
      .query("plannerAudit")
      .withIndex("by_created_at", (q) => q.lt("createdAt", now - AUDIT_RETENTION_MS))
      .take(PRUNE_BATCH_SIZE);
    const idempotencyRecords = await ctx.db
      .query("mcpIdempotency")
      .withIndex("by_created_at", (q) => q.lt("createdAt", now - IDEMPOTENCY_RETENTION_MS))
      .take(PRUNE_BATCH_SIZE);
    const rateLimitRecords = await ctx.db
      .query("mcpRateLimits")
      .withIndex("by_window", (q) => q.lt("window", Math.floor(now / 60_000) - RATE_LIMIT_RETENTION_MINUTES))
      .take(PRUNE_BATCH_SIZE);

    for (const row of [
      ...authorizationCodes,
      ...tokens,
      ...undoRecords,
      ...auditEntries,
      ...idempotencyRecords,
      ...rateLimitRecords,
    ]) {
      await ctx.db.delete(row._id);
    }

    return {
      authorizationCodes: authorizationCodes.length,
      tokens: tokens.length,
      auditEntries: auditEntries.length,
      undoRecords: undoRecords.length,
      idempotencyRecords: idempotencyRecords.length,
      rateLimitRecords: rateLimitRecords.length,
    };
  },
});
