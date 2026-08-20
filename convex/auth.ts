import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    GitHub({
      // Keep identities provider-bound. When Google is added, matching email
      // addresses must not silently merge two accounts and their planner data;
      // linking needs an explicit, authenticated flow.
      allowDangerousEmailAccountLinking: false,
    }),
  ],
});
