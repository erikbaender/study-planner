# Study Planner

Study Planner is a local-first web app for turning course material and exam dates into a practical study schedule. It tracks topics by workload, records progress, and can regenerate future study blocks without overwriting work placed manually.

The project uses Next.js, React, TypeScript, Tailwind CSS, Convex, and Convex Auth. It is designed to remain useful without signing in: signed-out data is stored in the browser, while authenticated data is synchronized through Convex.

> **Publication note:** this repository does not yet contain a license. Source being visible is not the same as being open source. A maintainer must choose and add a license before the first public release.

## Highlights

- Today, timeline, and outline views over one shared planning model
- Workload-aware scheduling with priorities, dependencies, study days, blackout dates, and manual-block preservation
- Bulk topic entry and two adaptive MHH sample datasets: the original plan and a feature showcase
- Local IndexedDB persistence and optional GitHub-authenticated Convex sync
- Versioned, validated JSON backup and restore
- Keyboard navigation, reduced-motion support, and accessible overlay primitives
- Pure domain modules with a broad Vitest suite

## Quick start

Prerequisites:

- Node.js 22–24
- pnpm 10.33 or a compatible pnpm 10 release

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>. No environment file or backend process is required: the app starts in local-only mode and stores data in this browser.

When `NEXT_PUBLIC_CONVEX_URL` is absent, the app does not construct or connect a Convex client. The configured Convex React and Auth stack is loaded through a separate client chunk only when sync is configured.

Cloud sync and sign-in are optional. To enable them, copy `.env.example` to `.env.local`, run `pnpm exec convex dev --once`, and follow [authentication and sync](docs/authentication.md). Use `pnpm convex:dev` in a second terminal when actively changing Convex functions.

Do not commit `.env.local`, OAuth secrets, JWT keys, exported planner files containing personal data, or Convex deployment credentials.

## Common commands

```bash
pnpm dev          # Next.js development server
pnpm test         # Vitest suite
pnpm test:watch   # Vitest in watch mode
pnpm lint         # ESLint, including React and accessibility rules
pnpm typecheck    # TypeScript without emitting files
pnpm check        # lint + typecheck + tests
pnpm build        # production build
pnpm audit:prod   # production dependency audit
pnpm convex:dev   # sync Convex functions and generated types in development
```

## Project map

```text
convex/              authenticated API, ownership checks, schema, auth
src/app/             Next.js entry points and global styles
src/auth/            provider-neutral application auth surface
src/data/            local and Convex repository implementations
src/domain/          pure types, dates, metrics, validation, scheduling
src/features/        product views and feature-specific components
src/lib/             JSON transfer format and other application utilities
src/ui/              shared controls, overlays, motion, and appearance
docs/                architecture, auth, data format, and audit notes
```

The UI depends on the `PlannerRepository` interface rather than IndexedDB or Convex directly. Domain logic stays framework-free. More detail is in [the architecture guide](docs/architecture.md).

## Data and authentication

Signed-out and signed-in data currently live in separate stores:

- **This device:** IndexedDB in the current browser profile
- **Synced:** records owned by the authenticated Convex user

Signing in changes which store is visible; it does not silently upload or merge local plans. Export a JSON backup before changing storage modes. An explicit migration flow is required before treating sign-in as seamless data transfer.

The current exporter writes transfer format v3. Import accepts v3 and unambiguous v2 files, appends plans and study history with fresh IDs, and leaves preferences unchanged; it is not a deduplicating or account-merge operation. See [the format specification](docs/data-format.md) before building another producer or a destructive replacement flow.

GitHub is the only configured OAuth provider. Google is planned, but automatic account merging by matching email is intentionally disabled. The required rollout and account-linking model are documented in [authentication and sync](docs/authentication.md).

## Documentation

- [Contributing](CONTRIBUTING.md)
- [Architecture](docs/architecture.md)
- [Authentication and sync](docs/authentication.md)
- [Planner JSON format](docs/data-format.md)
- [Quality, performance, and security audit](docs/quality-security-audit.md)
- [Security policy](SECURITY.md)

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Small, focused changes with tests are easiest to review. Generated Convex files should be regenerated through the Convex CLI, not edited manually.
