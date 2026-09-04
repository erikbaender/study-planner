# Authentication and deployment

## Runtime behavior

Study Planner has one storage and identity path: GitHub-authenticated Convex. Authentication resolves before the planner repository is mounted, so signed-out clients do not issue protected planner queries. Signing out unmounts active subscriptions and returns to the authentication gate. The same GitHub identity resolves to the same Convex user and therefore sees the same data after a reload or on another device.

`NEXT_PUBLIC_CONVEX_URL` is required by the application. If it is blank or missing, the application displays an actionable configuration error and never constructs a fallback planner. The client normalizes an accidental trailing slash before opening its WebSocket connection. `NEXT_PUBLIC_CONVEX_SITE_URL` is useful when configuring OAuth callbacks, but the Convex Auth client derives the corresponding HTTP Actions URL from `NEXT_PUBLIC_CONVEX_URL` and does not require it at runtime.

## Clean cutover decision

This project is version `0.1.0`, has no published releases, and its schema already records earlier data as intentionally disposable. Issue #57 therefore makes a clean pre-release cutover: legacy IndexedDB planner data is not migrated. The new runtime does not read, upload, merge, replace, or delete a browser's legacy database as a side effect of sign-in.

If previously shared development builds turn out to contain data that must be retained, stop rollout and create a bounded migration issue. A recovery tool may preview the legacy database after authentication and import only with explicit confirmation; it must not restore local mode.

## Local development

Run:

```bash
pnpm exec convex dev --once
```

The Convex command creates or selects a development deployment, deploys the current schema/functions, and writes `.env.local` with real browser-safe URLs. The values in `.env.example` are illustrative and must not be copied unchanged. Keep `pnpm convex:dev` running while editing Convex functions.

Create a development GitHub OAuth app with:

- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `https://<development-deployment>.convex.site/api/auth/callback/github`

Set server values on the Convex deployment, not in `.env.local`:

```bash
pnpm exec convex env set SITE_URL http://localhost:3000
pnpm exec convex env set AUTH_GITHUB_ID <client-id>
pnpm exec convex env set AUTH_GITHUB_SECRET <client-secret>
```

Convex Auth also requires `JWT_PRIVATE_KEY` and `JWKS`. Generate them through the setup flow for the installed `@convex-dev/auth` version and verify all required values with `pnpm exec convex env list` without copying secret values into logs or tickets.

## Preview deployments

Use a separate Convex deployment and GitHub OAuth app for preview. Set that preview deployment's `SITE_URL` to the exact preview browser origin, and set the OAuth callback to its exact Convex HTTP Actions URL plus `/api/auth/callback/github`. Supply the matching `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` in the preview host. Avoid wildcard callbacks and do not point previews at production data.

## Production deployment

Production requires its own Convex deployment and GitHub OAuth app. Before routing users to it:

1. Deploy the schema and functions with `pnpm convex:deploy`.
2. Set the three public deployment values in the Next.js host.
3. Set the exact production origin as Convex `SITE_URL`.
4. Set the GitHub client ID/secret and Convex Auth JWT/JWKS values in the production Convex environment.
5. Configure the GitHub callback as `https://<production-deployment>.convex.site/api/auth/callback/github`.
6. Run the two-account smoke test in issue #57, including sign-out, reload, a second browser session, backup restore, and reactive updates.

Never share OAuth credentials, JWT material, exported plans, or deployment credentials between development, preview, and production.

## Ownership and security

- Every public planner query and mutation requires a server-derived Convex Auth user ID.
- Plans and preferences store that owner directly. Courses, exams, topics, and blocks are authorized by walking their indexed parent relationship to the owned plan. Study-log queries use their owner index.
- A missing row and another user's row return the same not-found error, preventing ID probing.
- OAuth email is profile metadata, not an authorization or account-linking key. Dangerous email-based linking is disabled.
- Auth tokens are stored by Convex Auth in browser `localStorage`. Keep third-party scripts out of the origin and treat any script injection as an authentication issue.

## Backup and restore

Users can export a versioned JSON backup from the application and import it into the currently authenticated account. Imports are explicit, validated, additive operations; replacement is used only by deliberate reset/sample workflows. Back up before destructive changes.

Operators should also configure and test Convex deployment backups and restore them first in a non-production deployment. A whole-deployment restore is not a substitute for the user's portable export and must preserve auth tables together with owned planner rows.

## Account recovery and provider revocation

GitHub is currently the only account credential. A user who loses GitHub access has no email-based or alternate-provider recovery path; operators must not reassign ownership based only on matching email. Recover the GitHub account or handle the case through a separately reviewed, identity-verified procedure.

Revoking the Study Planner OAuth grant in GitHub prevents future authorization but may not immediately invalidate an already-issued application session. Sign out of Study Planner as well. Reauthorizing the same GitHub account should return to the same Convex user; verify this in the target environment before relying on it as a recovery procedure.

## Data deletion

Users can delete individual semesters and their dependent data in the application. Full account deletion is not yet self-service. Before accepting production users, the operator must publish a contact path and a verified runbook that:

1. confirms the requesting GitHub-bound identity;
2. offers a final JSON export;
3. deletes all plans, courses, exams, topics, blocks, study-log rows, preferences, and Convex Auth account/session records for that user;
4. records deletion without retaining planner content; and
5. states the backup-retention window after which restored copies also expire.

Provider revocation alone does not delete Convex data.

## Adding another provider

Keep provider identities separate by default. Adding Google or another provider requires an authenticated, fresh-auth linking flow with a previewable conflict policy. Never merge accounts or planner records by email, and test revoked grants, duplicate emails, already-linked providers, and two existing data sets before exposing the provider.
