# Authentication and sync

## Current behavior

Study Planner has two storage modes:

- **This device:** signed-out data stored in IndexedDB
- **Synced:** data owned by the authenticated Convex user

GitHub OAuth is currently the only sign-in provider. The UI talks to a provider-neutral auth facade, and backend ownership is derived from Convex's authenticated user ID.

Signing in switches repositories. It does not silently upload, merge, or delete local plans. Until an explicit migration workflow exists, users should export a backup before signing in or out.

With no `NEXT_PUBLIC_CONVEX_URL`, the app stays local-only: it does not construct or connect a Convex client, and the Convex React/Auth provider stack remains behind an unloaded dynamic client boundary. Setting the URL selects the configured provider chunk; it does not migrate local data.

## Local configuration

Run `pnpm exec convex dev --once` to create or select a Convex development deployment, deploy the current functions, and populate `.env.local` with the public URLs used by the browser. While changing Convex functions, run `pnpm convex:dev` continuously in a second terminal alongside `pnpm dev`.

Create a GitHub OAuth app whose callback is:

```text
https://<your-convex-site-host>/api/auth/callback/github
```

Set secrets on the Convex deployment, not in a public Next.js variable:

```bash
pnpm exec convex env set AUTH_GITHUB_ID <client-id>
pnpm exec convex env set AUTH_GITHUB_SECRET <client-secret>
```

Convex Auth also requires its JWT signing key and JWKS configuration. Follow the Convex Auth setup for the installed version and set the deployment's `SITE_URL` to the exact browser origin used for callbacks. `.env.example` lists only browser-safe configuration names.

## Security properties

- OAuth providers have dangerous email-based account linking disabled.
- Entity ownership is checked on every authenticated server query and mutation.
- OAuth email is profile metadata, not an application identity or authorization key.
- Security headers restrict framing, content types, browser permissions, and resource origins.
- Auth tokens are currently stored by Convex Auth in browser `localStorage`. The content security policy reduces XSS exposure, but it does not make script-readable tokens equivalent to HttpOnly cookies. Avoid third-party scripts and treat every HTML/script injection issue as an authentication issue.

## Adding Google

Adding `Google(...)` to the provider list is the last step, not the first. Complete this checklist before exposing it:

1. Keep `allowDangerousEmailAccountLinking: false` on GitHub and Google. Two providers returning the same email must initially create separate identities.
2. Add Google to `src/auth/providers.ts` so UI code never embeds provider-specific IDs.
3. Configure exact redirect origins and secrets independently for development, preview, and production.
4. Add an explicit local-to-synced migration choice: keep local, import into the signed-in account, or replace after a verified backup. Never infer consent from sign-in.
5. If cross-provider linking is needed, require an already authenticated session plus fresh authentication with the second provider. Show both identities, detect an existing destination account, and make any data merge previewable and recoverable.
6. Define conflict rules for plans, logs, and preferences before performing a merge. Use stable user/document IDs; never join records by email.
7. Test callback failures, denied consent, revoked grants, duplicate emails, linking an already-linked provider, two existing data sets, sign-out, and account deletion.
8. Review Google's current OAuth verification, branding, privacy-policy, and data-deletion requirements at implementation time.

The safest initial Google release is separate provider-bound accounts with no linking. Manual linking can be added later without risking an irreversible silent merge.

## Production checklist

- Use distinct OAuth apps and Convex deployments per environment.
- Restrict callbacks and allowed browser origins to exact production domains.
- Rotate any credential that has ever appeared in logs, screenshots, commits, or reports.
- Verify `AUTH_GITHUB_SECRET`, future Google secrets, JWT keys, and JWKS exist only in secret stores.
- Exercise backup/restore and account recovery before launch.
- Re-run the dependency audit and inspect response security headers.
