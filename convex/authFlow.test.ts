import { generateKeyPairSync } from "node:crypto";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const sentMail = vi.hoisted(() => [] as Array<{ to: string; text: string }>);

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (message: { to: string; text: string }) => {
        sentMail.push({ to: message.to, text: message.text });
        return { data: { id: `mail-${sentMail.length}` }, error: null };
      },
    };
  },
}));

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./_generated/*.js"),
};

let actionIdentity: { subject: string } | null = null;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.JWT_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.CONVEX_SITE_URL = "http://localhost:3210";
  process.env.SITE_URL = "http://localhost:3000";
  process.env.AUTH_RESEND_KEY = "re_test";
  process.env.AUTH_EMAIL_FROM = "Study Planner <auth@example.com>";
  process.env.AUTH_EMAIL_MODE = "preview";
  process.env.AUTH_EMAIL_PREVIEW_RECIPIENTS = [
    "new@example.com",
    "later@example.com",
    "victim@example.com",
    "taken@example.com",
    "limited@example.com",
    "locked@example.com",
  ].join(",");
  // Convex Auth enriches an action context by spreading `ctx.auth`. The
  // convex-test auth implementation keeps getUserIdentity on its prototype,
  // so the spread drops it. Supply the same identity method on the resulting
  // plain object; no auth provider or Convex Auth helper is mocked.
  Object.defineProperty(Object.prototype, "getUserIdentity", {
    configurable: true,
    value: async () => actionIdentity,
  });
});

afterAll(() => {
  delete (Object.prototype as { getUserIdentity?: unknown }).getUserIdentity;
});

beforeEach(() => sentMail.splice(0));

function latestCode(to: string) {
  const mail = sentMail.findLast((entry) => entry.to === to);
  const code = mail?.text.match(/\b\d{8}\b/)?.[0];
  if (!code) throw new Error(`No OTP delivered to ${to}`);
  return code;
}

async function seedSignedInUser(
  t: ReturnType<typeof convexTest>,
  provider = "github",
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 60 * 60_000,
    });
    await ctx.db.insert("authAccounts", {
      userId,
      provider,
      providerAccountId: `${provider}-${userId}`,
    });
    return { userId, sessionId, subject: `${userId}|${sessionId}` };
  });
}

async function startEmailChange(
  t: ReturnType<typeof convexTest>,
  subject: string,
  email: string,
) {
  actionIdentity = { subject };
  try {
    return await t.withIdentity({ subject }).action(api.auth.signIn, {
      provider: "email-change",
      params: { email },
    });
  } finally {
    actionIdentity = null;
  }
}

async function verifyEmailChange(
  t: ReturnType<typeof convexTest>,
  email: string,
  code: string,
) {
  return await t.action(api.auth.signIn, {
    provider: "email-change",
    params: { email, code },
  });
}

describe("Convex Auth email flows", () => {
  it("requests and verifies a change through the real auth provider and preserves ownership", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedSignedInUser(t);
    const planId = await t.run((ctx) =>
      ctx.db.insert("plans", {
        ownerId: owner.userId,
        name: "Owned plan",
        notes: "",
        revision: 0,
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await expect(startEmailChange(t, owner.subject, "New@Example.com")).resolves.toEqual({ tokens: null });
    const result = await verifyEmailChange(t, "new@example.com", latestCode("new@example.com"));
    expect(result.tokens?.token).toEqual(expect.any(String));

    const state = await t.run(async (ctx) => ({
      user: await ctx.db.get(owner.userId),
      plan: await ctx.db.get(planId),
      emailAccount: await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "email-otp").eq("providerAccountId", "new@example.com"),
        )
        .unique(),
      github: await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", owner.userId).eq("provider", "github"))
        .unique(),
    }));
    expect(state.user?.email).toBe("new@example.com");
    expect(state.emailAccount?.userId).toBe(owner.userId);
    expect(state.plan?.ownerId).toBe(owner.userId);
    expect(state.github).toBeNull();
  });

  it("rejects invalid, replayed, and expired change codes", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedSignedInUser(t);
    await startEmailChange(t, owner.subject, "new@example.com");
    const code = latestCode("new@example.com");
    await expect(verifyEmailChange(t, "new@example.com", "00000000")).rejects.toThrow();
    await verifyEmailChange(t, "new@example.com", code);
    await expect(verifyEmailChange(t, "new@example.com", code)).rejects.toThrow();

    const second = await seedSignedInUser(t);
    await startEmailChange(t, second.subject, "later@example.com");
    const expiredCode = latestCode("later@example.com");
    await t.run(async (ctx) => {
      const row = await ctx.db.query("authVerificationCodes").withIndex("code").unique();
      if (!row) throw new Error("Expected verification code");
      await ctx.db.patch(row._id, { expirationTime: Date.now() - 1 });
    });
    await expect(verifyEmailChange(t, "later@example.com", expiredCode)).rejects.toThrow();
  });

  it("keeps the delivered code valid when a resend is refused", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedSignedInUser(t);
    await startEmailChange(t, owner.subject, "new@example.com");
    const delivered = latestCode("new@example.com");
    await expect(startEmailChange(t, owner.subject, "new@example.com")).rejects.toThrow("wait");
    expect(sentMail.filter((mail) => mail.to === "new@example.com")).toHaveLength(1);
    await expect(verifyEmailChange(t, "new@example.com", delivered)).resolves.toMatchObject({
      tokens: { token: expect.any(String) },
    });
  });

  it("does not let an authenticated user pre-claim another person's future email sign-in", async () => {
    const t = convexTest(schema, modules);
    const attacker = await seedSignedInUser(t);
    await startEmailChange(t, attacker.subject, "victim@example.com");
    const attackerCode = latestCode("victim@example.com");

    await t.run(async (ctx) => {
      const counters = await ctx.db.query("authEmailSendLimits").collect();
      for (const counter of counters) await ctx.db.delete(counter._id);
    });
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email: "victim@example.com" },
    });
    const victimCode = latestCode("victim@example.com");
    expect(victimCode).not.toBe(attackerCode);
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email: "victim@example.com", code: victimCode },
    });

    const owners = await t.run(async (ctx) => {
      const account = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "email-otp").eq("providerAccountId", "victim@example.com"),
        )
        .unique();
      return { accountOwner: account?.userId, attacker: await ctx.db.get(attacker.userId) };
    });
    expect(owners.accountOwner).not.toBe(attacker.userId);
    expect(owners.attacker?.email).toBeUndefined();
  });

  it("rejects a verified change collision without moving either owner's data", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedSignedInUser(t);
    const otherId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "taken@example.com",
        emailVerificationTime: 1,
      });
      await ctx.db.insert("authAccounts", {
        userId,
        provider: "email-otp",
        providerAccountId: "taken@example.com",
        emailVerified: "taken@example.com",
      });
      return userId;
    });
    await startEmailChange(t, owner.subject, "taken@example.com");
    await expect(verifyEmailChange(t, "taken@example.com", latestCode("taken@example.com"))).rejects.toThrow(
      "cannot be used",
    );
    const state = await t.run(async (ctx) => ({ owner: await ctx.db.get(owner.userId), other: await ctx.db.get(otherId) }));
    expect(state.owner?.email).toBeUndefined();
    expect(state.other?.email).toBe("taken@example.com");
  });

  it("locks out the real code after the configured number of failed attempts", async () => {
    const t = convexTest(schema, modules);
    const owner = await seedSignedInUser(t);
    await startEmailChange(t, owner.subject, "limited@example.com");
    const code = latestCode("limited@example.com");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(verifyEmailChange(t, "limited@example.com", `${attempt}`.padStart(8, "9"))).rejects.toThrow();
    }
    await expect(verifyEmailChange(t, "limited@example.com", code)).rejects.toThrow();
    const user = await t.run((ctx) => ctx.db.get(owner.userId));
    expect(user?.email).toBeUndefined();
  });
});
