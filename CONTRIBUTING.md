# Contributing

Thank you for helping improve Study Planner. The project favors explicit domain rules, readable feature boundaries, and tests that describe user-visible behavior.

## Before contributing

This repository does not yet include a license. Until a maintainer adds one, do not assume permission to redistribute or reuse the source. The missing license is tracked as a publication blocker.

Never include student records beyond the intentional MHH sample fixture, private project reports, access tokens, OAuth credentials, deployment URLs that grant access, or exported planner backups in a contribution.

## Set up the project

Use Node.js 22–24 and pnpm 10.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

That starts the local-only app; no environment file or Convex process is required. For optional cloud sync and OAuth, run this setup once before starting the app:

```bash
cp .env.example .env.local
pnpm exec convex dev --once
```

Keep secrets in the Convex deployment environment or an ignored local environment file. See [docs/authentication.md](docs/authentication.md) for provider setup; copying the example alone does not configure OAuth. When changing Convex functions, run `pnpm convex:dev` in a second terminal alongside `pnpm dev`.

## Make a change

1. Start from a focused issue and avoid unrelated formatting or generated-file churn.
2. Put business rules in `src/domain`, persistence behavior in `src/data` or `convex`, and reusable controls in `src/ui`.
3. Add a regression test for a bug and focused tests for new behavior.
4. Run `pnpm check`. Run `pnpm build` for routing, configuration, dependency, or bundling changes.
5. Run `pnpm audit:prod` when production dependencies change.
6. Describe behavior, risk, and verification in the pull request.

Use `pnpm exec convex dev --once` when a Convex schema or function signature changes. Files under `convex/_generated` are generated output.

## Design conventions

- Prefer plain code over compact tricks. Extract a module when it owns a coherent responsibility, not merely to reduce a line count.
- Keep dates as real `YYYY-MM-DD` calendar dates at domain and API boundaries.
- Treat local and Convex repositories as implementations of the same contract. A feature must not branch on its storage backend.
- Validate untrusted data at both the client import boundary and the authenticated server boundary.
- Preserve object identity for unchanged domain entities so memoized rows do not rerender unnecessarily.
- Use native controls when possible. Every icon-only control needs an accessible name and every operation must remain usable by keyboard.
- Context-menu rows use an icon followed by an action-only label: `Delete`, not `Delete topic`.
- Inspector sections have one label and one control group, separated consistently.
- Related animation layers share the duration and easing values in `src/ui/motion.ts`.

## Tests

Vitest projects separate pure code from DOM-dependent code:

- `domain`: non-DOM `.test.ts` files in `src/domain`, `src/data`, `src/lib`, and `convex`
- `ui`: `.test.tsx` files in `src/ui` and the React repository bridge in `src/data`
- `features`: assembled feature behavior in `src/features`

Prefer observable outcomes over implementation details. Avoid snapshots for interactive behavior when roles, names, state, and callbacks can be asserted directly.

## Pull requests

A useful pull request includes:

- the problem and intended user outcome;
- screenshots or a short recording for visible UI changes;
- tests added or updated;
- commands run and their results;
- migration, privacy, performance, or accessibility impact;
- follow-up work that was deliberately left out.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md), not in a public issue.
