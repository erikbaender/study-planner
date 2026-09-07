import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { emailSendWindows, isValidEmail, normalizeEmail, sha256 } from "./authEmail";
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

describe("email authentication security", () => {
  it("normalizes without provider-specific alias rewriting", () => {
    expect(normalizeEmail("  Person+study@Example.COM ")).toBe("person+study@example.com");
    expect(isValidEmail("person@example.com")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
  });

  it("hashes recipient keys so send counters do not store email addresses", async () => {
    const digest = await sha256("person@example.com");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("person");
  });

  it("enforces the resend cooldown transactionally under concurrency", async () => {
    const t = convexTest(schema, modules);
    const recipientDigest = await sha256("person@example.com");
    const now = Date.UTC(2026, 8, 6, 12, 0, 1);
    const results = await Promise.allSettled([
      t.mutation(internal.authEmail.reserveSend, { recipientDigest, now }),
      t.mutation(internal.authEmail.reserveSend, { recipientDigest, now }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("allows three sends per recipient in 15 minutes and refuses the fourth", async () => {
    const t = convexTest(schema, modules);
    const recipientDigest = await sha256("person@example.com");
    const base = Date.UTC(2026, 8, 6, 12, 0, 1);
    for (const offset of [0, 60_000, 120_000]) {
      await t.mutation(internal.authEmail.reserveSend, { recipientDigest, now: base + offset });
    }
    await expect(
      t.mutation(internal.authEmail.reserveSend, { recipientDigest, now: base + 180_000 }),
    ).rejects.toThrow("wait");
    expect(emailSendWindows(base).recipient).toBe(emailSendWindows(base + 180_000).recipient);
  });

  it("rejects migration to an email already owned by another account", async () => {
    const t = convexTest(schema, modules);
    const [aliceId, bobId] = await t.run(async (ctx) => [
      await ctx.db.insert("users", { email: "alice@example.com", emailVerificationTime: 1 }),
      await ctx.db.insert("users", { email: "bob@example.com", emailVerificationTime: 1 }),
    ]);
    await t.run((ctx) =>
      ctx.db.insert("authAccounts", {
        userId: aliceId,
        provider: "email-otp",
        providerAccountId: "alice@example.com",
        emailVerified: "alice@example.com",
      }),
    );
    const aliceEmailDigest = await sha256("alice@example.com");
    await t.run((ctx) =>
      ctx.db.insert("authAccounts", {
        userId: bobId,
        provider: "email-change",
        providerAccountId: `test:${aliceEmailDigest}`,
      }),
    );
    await expect(
      t.mutation(internal.authEmail.finalizeEmailChange, {
        userId: bobId,
        email: "alice@example.com",
        now: Date.now(),
      }),
    ).rejects.toThrow("cannot be used");
  });

  it("consolidates a user's old and target email accounts without duplicates", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { email: "old@example.com" }));
    const newEmailDigest = await sha256("new@example.com");
    await t.run(async (ctx) => {
      const oldAccountId = await ctx.db.insert("authAccounts", {
        userId, provider: "email-otp", providerAccountId: "old@example.com", emailVerified: "old@example.com",
      });
      await ctx.db.insert("authAccounts", {
        userId, provider: "email-otp", providerAccountId: "new@example.com", emailVerified: "new@example.com",
      });
      await ctx.db.insert("authAccounts", {
        userId, provider: "email-change", providerAccountId: `test:${newEmailDigest}`,
      });
      await ctx.db.insert("authAccounts", {
        userId, provider: "github", providerAccountId: "legacy-github-id",
      });
      await ctx.db.insert("authVerificationCodes", {
        accountId: oldAccountId,
        provider: "email-otp",
        code: "stale-digest",
        expirationTime: Date.now() + 600_000,
        emailVerified: "old@example.com",
      });
    });
    await t.mutation(internal.authEmail.finalizeEmailChange, {
      userId, email: "new@example.com", now: 123,
    });
    const accounts = await t.run((ctx) =>
      ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) =>
        q.eq("userId", userId).eq("provider", "email-otp"),
      ).collect(),
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0].providerAccountId).toBe("new@example.com");
    const retired = await t.run(async (ctx) => ({
      staleCode: await ctx.db.query("authVerificationCodes").withIndex("code", (q) => q.eq("code", "stale-digest")).unique(),
      github: await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) =>
        q.eq("userId", userId).eq("provider", "github"),
      ).unique(),
    }));
    expect(retired).toEqual({ staleCode: null, github: null });
  });
});
