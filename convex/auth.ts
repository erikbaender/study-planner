import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTP } from "./ResendOTP";
import { EmailChange } from "./EmailChange";
import type { MutationCtx } from "./_generated/server";
import { reserveEmailSend, sha256 } from "./authEmail";

const DAY = 24 * 60 * 60 * 1_000;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ResendOTP,
    EmailChange,
    // Migration only: retire after every retained GitHub account has linked a
    // verified email account. It is not presented as the normal sign-in path.
    ...(process.env.AUTH_GITHUB_MIGRATION_ENABLED === "true"
      ? [GitHub({ allowDangerousEmailAccountLinking: false })]
      : []),
  ],
  session: { totalDurationMs: 30 * DAY, inactiveDurationMs: 7 * DAY },
  signIn: { maxFailedAttempsPerHour: 5 },
  callbacks: {
    // Convex Auth normally links verified email providers by matching `users.email`.
    // Keep provider accounts separate; linking requires the authenticated flow in account.ts.
    async createOrUpdateUser(ctx, { existingUserId, type, profile, provider }) {
      const appCtx = ctx as MutationCtx;
      const email = typeof profile.email === "string" ? profile.email : undefined;
      if (type === "email" && email) {
        // This runs before Convex Auth replaces the current code, so a refused
        // concurrent resend cannot invalidate the last code that was delivered.
        await reserveEmailSend(appCtx, await sha256(email), Date.now());
      }
      if (existingUserId) {
        if (type === "verification" && provider.id === "email-change") return existingUserId;
        if (type === "verification" && email) {
          const matches = await appCtx.db.query("users").withIndex("email", (q) => q.eq("email", email)).take(2);
          if (matches.some((user) => user._id !== existingUserId && user.emailVerificationTime !== undefined)) {
            throw new Error("This email address cannot be used.");
          }
          await appCtx.db.patch(existingUserId, { email, emailVerificationTime: Date.now() });
        }
        return existingUserId;
      }

      // Email providers create the account before the code is verified. Do not
      // put an unverified address on the user document or use it for linking.
      if (type === "email") {
        return await appCtx.db.insert("users", {});
      }

      if (type === "oauth") {
        throw new Error("GitHub sign-in is available only to migrate an existing account.");
      }
      return await appCtx.db.insert("users", {
        name: typeof profile.name === "string" ? profile.name : undefined,
        image: typeof profile.image === "string" ? profile.image : undefined,
        email,
      });
    },
  },
});
