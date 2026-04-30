# Study Planner

Study Planner is a Next.js, TypeScript, Tailwind, Ionic, and Convex web app for planning course topics and milestones on an interactive Gantt chart.

## Current Status

The MVP implementation includes:

- Next.js App Router project scaffolded with pnpm.
- Apple-inspired responsive planner UI.
- Plan, course, topic, milestone, and topic-range data structures.
- Interactive Gantt chart bars that can be dragged or resized by day.
- Versioned JSON export and create-only JSON import helpers.
- Authenticated Convex persistence with local fallback for development.
- GitHub OAuth via Convex Auth.
- Planner CRUD for plans, courses, topics, milestones, topic ranges, and within-course dependencies.
- Delete confirmations and empty states for sparse or freshly reset accounts.
- Server-side GitHub issue preview/import for reference repositories such as `erikbaender/mhh`.

The development account has been populated with the full `erikbaender/mhh` GitHub sample import: 123 issues grouped into 7 source-language courses.

## Development

```bash
pnpm install
pnpm dev
```

The local app runs at:

```text
http://localhost:3000
```

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm exec convex dev --once --typecheck disable
```

## Convex

A Convex dev deployment has been configured for this Codespace. The generated `.env.local` is intentionally ignored by git.

For local OAuth redirects, the Convex `SITE_URL` env var has been set to:

```text
http://localhost:3000
```

## GitHub OAuth Setup

Create a GitHub OAuth app for local development and configure its callback URL to match the Convex HTTP actions URL:

```text
https://<convex-site-url>/api/auth/callback/github
```

The Convex HTTP actions URL is available in `.env.local` as `NEXT_PUBLIC_CONVEX_SITE_URL` and in the Convex dashboard deployment settings.

Then set the following Convex environment variables:

```bash
pnpm exec convex env set AUTH_GITHUB_ID <github-oauth-client-id>
pnpm exec convex env set AUTH_GITHUB_SECRET <github-oauth-client-secret>
```

Convex Auth also requires JWT signing environment variables before production OAuth is complete. Follow the Convex Auth manual setup guide to set `JWT_PRIVATE_KEY` and `JWKS` on the Convex deployment.

## GitHub Issue Import

Authenticated imports can use a Convex-side token so the browser does not need to hold a GitHub access token:

```bash
pnpm exec convex env set GITHUB_IMPORT_TOKEN <github-issues-read-token>
```

The importer preserves GitHub issue titles, milestones, labels, and body text as source data. German study-plan issue content should stay German; the app should not translate it during import.

The GitHub import modal previews issue counts and course grouping before creating a plan. In authenticated mode, preview and import both use the Convex-side token when the token field is left empty.

## Reports

Development progress reports are stored in [reports](reports).