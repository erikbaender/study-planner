# Study Planner

Study Planner is an account-backed web app for turning course material and exam dates into a practical study schedule. It tracks topics by workload, records progress, and can regenerate future study blocks without overwriting work placed manually.

The project uses Next.js, React, TypeScript, Tailwind CSS, Convex, and Convex Auth. Convex is the sole planner data store, and GitHub authentication is required before planner data is loaded or changed.

> **Publication note:** this repository does not yet contain a license. Source being visible is not the same as being open source. A maintainer must choose and add a license before the first public release.

## Highlights

- Today, timeline, and outline views over one shared planning model
- Workload-aware scheduling with priorities, dependencies, study days, blackout dates, and manual-block preservation
- Direct timeline creation, dragging, resizing, deletion, and generated-schedule reflow
- Bulk topic entry and two adaptive MHH sample datasets
- GitHub-authenticated, account-owned Convex persistence across browsers and devices
- Versioned, validated JSON backup and restore
- Keyboard navigation, reduced-motion support, and accessible overlay primitives

## Quick start

Prerequisites:

- Node.js 22–24
- pnpm 10.33 or a compatible pnpm 10 release
- a Convex account and GitHub OAuth application

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec convex dev --once
pnpm dev
```

The Convex command creates or selects a development deployment, deploys the functions, and writes the required public URLs to `.env.local`. Configure GitHub OAuth and the deployment secrets in [the authentication guide](docs/authentication.md) before opening <http://localhost:3000>. Missing configuration produces a setup error; there is no browser-storage fallback.

Use `pnpm convex:dev` in a second terminal while changing Convex functions. Do not commit `.env.local`, OAuth secrets, JWT keys, exported planner files containing personal data, or deployment credentials.

## Common commands

```bash
pnpm dev          # Next.js development server
pnpm test         # Vitest suite
pnpm lint         # ESLint, including React and accessibility rules
pnpm typecheck    # TypeScript without emitting files
pnpm check        # lint + typecheck + tests
pnpm build        # production build
pnpm audit:prod   # production dependency audit
pnpm convex:dev   # deploy functions continuously to development
pnpm convex:deploy # deploy functions to the selected deployment
```

## Project map

```text
convex/              authenticated API, ownership checks, schema, auth
src/app/             Next.js entry points and global styles
src/auth/            application authentication surface
src/components/      required cloud provider and authentication gate
src/data/            repository contract and Convex adapter
src/domain/          pure types, dates, metrics, validation, scheduling
src/features/        product views and feature-specific components
src/lib/             JSON transfer format and other application utilities
src/ui/              shared controls, overlays, motion, and appearance
docs/                architecture, auth, data format, and audit notes
```

The UI depends on `PlannerRepository`, while the only runtime implementation maps it to authenticated Convex functions. Domain logic stays framework-free. More detail is in [the architecture guide](docs/architecture.md).

## Data and authentication

Every planner record belongs to the authenticated Convex user. Signing out unmounts the repository and hides the account data; signing back into the same GitHub identity restores it. Import and export are explicit account backup operations, not synchronization or account merging.

The writer emits transfer format v3. Import accepts v3 and unambiguous v2 files, appends plans and study history with fresh IDs, and leaves preferences unchanged. See [the format specification](docs/data-format.md).

GitHub is the only configured OAuth provider. Automatic account merging by matching email is disabled. Environment setup, recovery, deletion, backup, and provider revocation are documented in [authentication](docs/authentication.md).

## Documentation

- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/architecture.md)
- [Authentication and deployment](docs/authentication.md)
- [Planner JSON format](docs/data-format.md)
- [Quality, performance, and security audit](docs/quality-security-audit.md)
- [Security policy](SECURITY.md)

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Small, focused changes with tests are easiest to review. Generated Convex files should be regenerated through the Convex CLI, not edited manually.
