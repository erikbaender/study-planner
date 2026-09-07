import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";

export const EMAIL_CODE_TTL_MS = 10 * 60 * 1_000;

const RECIPIENT_WINDOW_MS = 15 * 60 * 1_000;
const RECIPIENT_SEND_LIMIT = 3;
const COOLDOWN_WINDOW_MS = 60 * 1_000;
const GLOBAL_WINDOW_MS = 60 * 60 * 1_000;
const GLOBAL_SEND_LIMIT = 30;
const GLOBAL_DAILY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const GLOBAL_DAILY_SEND_LIMIT = 100;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function emailSendWindows(now: number) {
  return {
    cooldown: Math.floor(now / COOLDOWN_WINDOW_MS) * COOLDOWN_WINDOW_MS,
    recipient: Math.floor(now / RECIPIENT_WINDOW_MS) * RECIPIENT_WINDOW_MS,
    global: Math.floor(now / GLOBAL_WINDOW_MS) * GLOBAL_WINDOW_MS,
    globalDaily: Math.floor(now / GLOBAL_DAILY_WINDOW_MS) * GLOBAL_DAILY_WINDOW_MS,
  };
}

export async function reserveEmailSend(
  ctx: Pick<MutationCtx, "db">,
  recipientDigest: string,
  now: number,
) {
  const windows = emailSendWindows(now);
  const limits = [
    { key: `cooldown:${recipientDigest}`, windowStart: windows.cooldown, maximum: 1 },
    { key: `recipient:${recipientDigest}`, windowStart: windows.recipient, maximum: RECIPIENT_SEND_LIMIT },
    { key: "global", windowStart: windows.global, maximum: GLOBAL_SEND_LIMIT },
    { key: "global-daily", windowStart: windows.globalDaily, maximum: GLOBAL_DAILY_SEND_LIMIT },
  ];

  const rows = await Promise.all(
    limits.map((limit) =>
      ctx.db
        .query("authEmailSendLimits")
        .withIndex("by_key_and_window_start", (q) =>
          q.eq("key", limit.key).eq("windowStart", limit.windowStart),
        )
        .unique(),
    ),
  );
  if (rows.some((row, index) => (row?.count ?? 0) >= limits[index].maximum)) {
    throw new Error("Please wait before requesting another code.");
  }
  for (let index = 0; index < limits.length; index += 1) {
    const row = rows[index];
    const limit = limits[index];
    if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
    else await ctx.db.insert("authEmailSendLimits", { key: limit.key, windowStart: limit.windowStart, count: 1 });
  }
}

/** Reserves both quotas transactionally; OCC serializes concurrent resends. */
export const reserveSend = internalMutation({
  args: { recipientDigest: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, { recipientDigest, now }) => {
    await reserveEmailSend(ctx, recipientDigest, now);
    return null;
  },
});

export const prepareOwnedAnchorAccount = internalMutation({
  args: { userId: v.id("users"), sessionId: v.id("authSessions"), emailDigest: v.string() },
  returns: v.id("authAccounts"),
  handler: async (ctx, { userId, sessionId, emailDigest }) => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== userId) throw new Error("Not authenticated.");
    const providerAccountId = `${sessionId}:${emailDigest}`;
    const anchors = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "email-change"))
      .take(101);
    if (anchors.length > 100) throw new Error("Too many active email change requests.");
    const existing = anchors.find((account) => account.providerAccountId === providerAccountId);
    if (existing) return existing._id;
    for (const account of anchors.filter((candidate) =>
      typeof candidate.providerAccountId === "string" && candidate.providerAccountId.startsWith(`${sessionId}:`),
    )) {
      const code = await ctx.db.query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id)).unique();
      if (code) await ctx.db.delete(code._id);
      await ctx.db.delete(account._id);
    }
    return await ctx.db.insert("authAccounts", {
      userId,
      provider: "email-change",
      providerAccountId,
    });
  },
});

export const finalizeEmailChange = internalMutation({
  args: { userId: v.id("users"), email: v.string(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const emailDigest = await sha256(args.email);
    const anchors = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId).eq("provider", "email-change"))
      .take(101);
    if (anchors.length > 100) throw new Error("Too many active email change requests.");
    if (!anchors.some((anchor) => anchor.providerAccountId.endsWith(`:${emailDigest}`))) {
      throw new Error("The email change request is no longer valid.");
    }
    const existingAccount = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "email-otp").eq("providerAccountId", args.email),
      )
      .unique();
    if (existingAccount && existingAccount.userId !== args.userId) {
      throw new Error("This email address cannot be used.");
    }
    const verifiedUsers = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .take(2);
    if (verifiedUsers.some((user) => user._id !== args.userId && user.emailVerificationTime !== undefined)) {
      throw new Error("This email address cannot be used.");
    }
    const currentAccounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId).eq("provider", "email-otp"))
      .take(10);
    const targetAccount = existingAccount?.userId === args.userId ? existingAccount : null;
    const accountToKeep = targetAccount ?? currentAccounts[0] ?? null;
    // Codes are bound to an account ID. Remove stale codes before renaming or
    // deleting accounts so a code issued for the old address cannot be replayed.
    for (const account of currentAccounts) {
      const code = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .unique();
      if (code) await ctx.db.delete(code._id);
    }
    if (accountToKeep) {
      await ctx.db.patch(accountToKeep._id, {
        providerAccountId: args.email,
        emailVerified: args.email,
      });
    } else {
      await ctx.db.insert("authAccounts", {
        userId: args.userId,
        provider: "email-otp",
        providerAccountId: args.email,
        emailVerified: args.email,
      });
    }
    for (const account of currentAccounts) {
      if (account._id !== accountToKeep?._id) await ctx.db.delete(account._id);
    }
    const githubAccounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId).eq("provider", "github"))
      .take(2);
    for (const account of githubAccounts) await ctx.db.delete(account._id);
    await ctx.db.patch(args.userId, { email: args.email, emailVerificationTime: args.now });
    for (const anchor of anchors) {
      const code = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", anchor._id))
        .unique();
      if (code) await ctx.db.delete(code._id);
      await ctx.db.delete(anchor._id);
    }
    return null;
  },
});
