# Authentication and deployment

## Runtime behavior

Study Planner uses email verification codes with Convex Auth. Enter an email address, request a code, and enter or paste it on the same page. There is no email login link or identity-provider redirect. A pending in-app destination, including MCP authorization parameters, remains on the initiating page.

Authentication resolves before the planner repository mounts. Signed-out clients do not issue protected planner queries; sign-out unmounts subscriptions and removes account data from the React tree. Ownership always comes from the authenticated internal Convex user ID, never a client-supplied email or owner ID.

`NEXT_PUBLIC_CONVEX_URL` is required. Missing configuration displays a setup error rather than constructing a fallback planner. The client normalizes a trailing slash. Public deployment URLs identify the backend but are not credentials.

## Email delivery setup

The delivery provider is **Resend**, called from the Convex backend. You can create a Resend account directly or provision it through the [Vercel Marketplace](https://vercel.com/marketplace/resend). The integration still requires the sending key in **Convex**, where authentication runs; a Vercel environment variable alone does not configure the backend.

1. Create a Resend account and add a domain or sending subdomain you own, for example `auth.example.com`.
2. Add the exact DNS records shown by Resend at your DNS provider, then wait for verification. A `vercel.app` or `convex.site` deployment hostname is not a domain you own.
3. Choose a sender such as `Study Planner <login@auth.example.com>`. This is an example, not a configured sender. The sender does not require a separate mailbox; provide a monitored support address separately.
4. Create a sending-only API key scoped to the verified domain. For development and preview deployments, configure Convex Project Settings environment variable defaults with a shared non-production `AUTH_RESEND_KEY`, `AUTH_EMAIL_MODE=preview`, and `AUTH_EMAIL_FROM`. Optionally set `AUTH_EMAIL_ALLOWED_RECIPIENTS` to a comma-separated list of exact addresses and whole domains, such as `alice@example.com,example.org,@partner.net`. When set, only those recipients are accepted. Configure distinct production Resend credentials and explicitly set `AUTH_EMAIL_MODE=production` there.
5. Keep `SITE_URL` set to the exact frontend origin and provision Convex Auth's `JWT_PRIVATE_KEY` and `JWKS` separately for each deployment. Keep existing signing keys during compatible deployments to preserve sessions.

Use Convex Project Settings to define separate environment variable defaults by deployment type. Set the development `SITE_URL` default to `http://localhost:3000`, because every local worktree uses that origin. A hosted preview has its own dynamic origin, so the workflow that creates its Convex deployment must also set `SITE_URL` from the hosting provider's canonical preview URL. Do not use the localhost default for preview deployments. Defaults apply only when a new deployment is created and are not synchronized into existing deployments, so backfill current deployments once. When rotating a credential, update both the defaults and every active deployment. Vercel environment variables alone do not configure the Convex backend.

Keep `JWT_PRIVATE_KEY` and `JWKS` unique to each deployment; do not place shared signing material in project defaults. `pnpm dlx @convex-dev/auth` is the supported interactive setup flow for an independently created deployment and preserves existing keys unless you explicitly approve replacing them. Automated preview provisioning must generate and store an independent pair when it creates a new backend; branch startup must not replace an existing pair. Never put keys, signing material, verification codes, or reusable tokens in `NEXT_PUBLIC_*`, source control, logs, tickets, or screenshots. Do not paste the output of `convex env list`, which can include secret values.

See [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction) and [Convex Auth email OTPs](https://labs.convex.dev/auth/config/otps).

## Codes, abuse controls, and delivery errors

Codes contain eight random digits generated with the Oslo cryptographic random-string library and expire after ten minutes. Convex Auth stores hashes, verifies codes transactionally, and consumes successful codes once. Its verification limiter allows five failed attempts per hour per normalized email, with gradual replenishment. Provider authorization binds the submitted email to the account whose code is being verified.

Send reservations and code replacement run in the same database transaction. Limits are one request per recipient per minute bucket, three per 15-minute bucket, 30 globally per hour, and 100 globally per UTC day. Global limits cover callers even when a trustworthy source IP is unavailable in Convex actions. These are fixed windows: adjacent windows can allow requests close together; the UI separately enforces a 60-second resend countdown. Recipient counter keys contain address digests. Successful reservations consume quota even if delivery subsequently fails, preventing retry loops from bypassing sending limits.

An accepted resend invalidates the old code. A rejected reservation rolls back without replacing it. A delivery failure after acceptance leaves the previous code invalidated; wait for cooldown and request another code. Delivery API acceptance does not prove inbox delivery: check spam, suppression, bounces, and provider status without logging message bodies or codes. Keep provider-side quotas and alerts enabled. The limits above are per backend; multiple preview backends sharing a Resend account also share its provider quota.

Login messages do not disclose whether an account exists. A verified email-change collision is reported without revealing the other account. Increasing limits requires a review of the sending plan and abuse risk.

## Local, preview, and automated testing

Run `pnpm exec convex dev --once` to configure the worktree's development backend and generate public URLs in `.env.local`. New development backends inherit the project defaults, including the shared localhost frontend origin and email settings, but each backend still needs its own signing key pair provisioned once. Sharing port 3000 does not mean worktrees share a Convex database. Keep secrets in the backend environment. Configure the shared development service as described in `AGENTS.md`; do not run a competing server on another port.

`AUTH_EMAIL_MODE` defaults to `preview`. Configure development and preview project defaults with a shared non-production Resend sending key/domain and the verified non-production sender. `AUTH_EMAIL_ALLOWED_RECIPIENTS` is optional; when absent, any valid recipient is accepted, and when present, entries can be exact addresses or whole domains. Delivery remains subject to the per-recipient and global rate limits. Production uses distinct Resend credentials and explicitly sets `AUTH_EMAIL_MODE=production`. Every deployment keeps independent Convex signing material. Untrusted fork builds receive no sending keys or backend deploy credentials.

Automated tests mock the Resend transport in the test process and capture generated codes in memory while exercising library verification. There is no hosted fixed code, code-return endpoint, code logging, or environment-controlled authentication bypass. This verifies authentication without sending real email; it does not establish production deliverability.

Before rollout, configure a verified sender and exercise real local/hosted delivery, reload and browser restart, sign-out, expiry, resend, wrong/expired/replayed codes, retained-account migration, collisions, and two-account isolation. Run the MCP consent/read/write/refresh/revocation flow against the target backend. Automated tests and a frontend error-state smoke test are not substitutes for that deployment check.

## Sessions and compatible deployments

Convex Auth owns session creation, token refresh, and sign-out. Sessions have a 30-day absolute lifetime and a seven-day inactivity limit. Users do not request a new code on every page load. Browser storage persists authentication across reloads and browser restarts until sign-out, expiry, revocation, or storage clearing.

Compatible frontend/backend pushes retain sessions when the browser origin, backend database, and signing configuration remain stable. A different browser origin has separate storage. A new, reset, or expired Convex deployment requires fresh authentication; no credentials or production account data are copied into preview backends. Token storage is script-readable, so keeping untrusted scripts out of the application origin remains essential.

## Account identity, transition, and recovery

Internal account IDs remain independent of email addresses. Email normalization trims surrounding whitespace and lowercases the address; it does not remove dots, strip plus tags, or apply provider-specific aliases. Matching an OAuth profile email never authorizes linking or a merge.

Current GitHub-backed Convex accounts are retained. The historical browser-storage cutover below does **not** authorize deleting them. Set `AUTH_GITHUB_MIGRATION_ENABLED=true` only on a deployment retaining GitHub accounts, keeping its existing `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`. The default is email-only. A temporary migration-only GitHub path permits existing users to prove their existing identity and verify an email address while retaining the same internal user ID and planner ownership. A destination already attached to another account is a conflict, not permission to merge planner data.

Retire migration access only after a bounded inventory confirms every retained GitHub account has a verified email credential and the owner has verified access to its retained data. Then remove `AUTH_GITHUB_MIGRATION_ENABLED` (or set it to `false`), remove the retired migration code in a cleanup change, revoke the GitHub OAuth application credentials, and remove `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`. Fresh email-only environments must not need GitHub callback registration. Until retirement, retained environments keep their existing exact GitHub callback; no callback broker is introduced.

A signed-in user changes email by verifying the destination mailbox through Account settings. Ownership stays with the same internal user ID. Completion retires the old email credential and outstanding codes, removes the migrated GitHub credential, and invalidates other application sessions. MCP grants remain attached to that same owner; revoke them separately if compromise is suspected. Do not reassign accounts based on an unverified claim, a screenshot, or a matching profile address. Loss of mailbox access has no automatic alternate-identity recovery: recover the mailbox with its provider or use a separately reviewed support procedure with independent proof. Publish a monitored support contact before accepting production users.

After suspected compromise, the operator must revoke the affected Convex Auth sessions/refresh credentials **and** MCP grants, investigate access, and require fresh authentication using a secured mailbox. Browser sign-out alone is not revocation of other devices or MCP clients. Already-issued bearer JWT validity must be considered in an incident response; do not promise immediate global revocation from deleting a browser token.

## MCP boundary

Only human sign-in changes. MCP discovery, registered client redirect URIs, PKCE, consent, exact issuer/resource binding, refresh rotation, and grant revocation remain separate. Email verification resumes the pending consent page and resolves its same internal owner. Verify two-account planner isolation and MCP reads/writes, refresh, and revocation before rollout.

## Historical browser-storage cutover

This project is version `0.1.0`, has no published releases, and its schema already records earlier data as intentionally disposable. Issue #57 made a clean pre-release cutover: legacy IndexedDB planner data is not migrated. The new runtime does not read, upload, merge, replace, or delete a browser's legacy database as a side effect of sign-in.

If previously shared development builds turn out to contain data that must be retained, stop rollout and create a bounded migration issue. A recovery tool may preview the legacy database after authentication and import only with explicit confirmation; it must not restore local mode.

## Backup and deletion

Users can export a versioned JSON backup and import it into the currently authenticated account. Imports are explicit, validated, additive operations. A whole-deployment restore must preserve auth tables together with owned planner rows; test restores in a non-production deployment first.

Full account deletion is not yet self-service. Operators must verify the requesting identity, offer a final export, remove owned planner rows and auth records, revoke MCP grants, record deletion without planner content, and publish a backup-retention window. Revoking a provider credential does not delete planner data.
