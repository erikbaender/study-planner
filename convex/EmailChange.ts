import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { getAuthSessionId, getAuthUserId, invalidateSessions, signInViaProvider } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { isValidEmail, normalizeEmail, sha256 } from "./authEmail";
import { ResendChangeOTP } from "./ResendOTP";

export const EmailChange = ConvexCredentials({
  id: "email-change",
  extraProviders: [ResendChangeOTP],
  async authorize(credentials, ctx) {
    const rawEmail = credentials.email;
    if (typeof rawEmail !== "string") throw new Error("Enter a valid email address.");
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) throw new Error("Enter a valid email address.");

    if (typeof credentials.code !== "string") {
      const userId = await getAuthUserId(ctx);
      const sessionId = await getAuthSessionId(ctx);
      if (!userId || !sessionId) throw new Error("Not authenticated.");
      const accountId = await ctx.runMutation(internal.authEmail.prepareOwnedAnchorAccount, {
        userId, sessionId, emailDigest: await sha256(email),
      });
      await signInViaProvider(ctx, ResendChangeOTP, { accountId, params: { email } });
      return null;
    }

    const verified = await signInViaProvider(ctx, ResendChangeOTP, {
      params: { email, code: credentials.code.trim() },
    });
    if (!verified) return null;
    await ctx.runMutation(internal.authEmail.finalizeEmailChange, {
      userId: verified.userId,
      email,
      now: Date.now(),
    });
    await invalidateSessions(ctx, { userId: verified.userId, except: [verified.sessionId] });
    return verified;
  },
});
