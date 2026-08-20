# Architecture

Study Planner is a client-heavy Next.js application with a pure planning core and two interchangeable persistence implementations.

```text
React features ──> PlannerRepository ──┬──> IndexedDB (this device)
       │                               └──> Convex API (authenticated sync)
       └────────> pure domain modules ────> dates, metrics, scheduling, validation
```

## Boundaries

### Domain: `src/domain`

Domain modules know nothing about React, IndexedDB, or Convex. They own calendar calculations, progress and health metrics, outline parsing, scheduling, shared types, and deterministic sample generation. Scheduling returns an explicit result, including infeasible shortfalls, rather than hiding failure in side effects.

Dates are day-granular ISO calendar strings (`YYYY-MM-DD`). Code must use the helpers in `src/domain/dates.ts`; parsing a date with the JavaScript `Date` constructor can introduce timezone shifts.

### Persistence: `src/data` and `convex`

`PlannerRepository` is the application storage boundary. Feature code receives one implementation and must not branch on the backend.

- The local repository persists one snapshot in IndexedDB. Mutations are serialized and use immutable updates so untouched siblings retain identity. A save resolves on the IndexedDB transaction's `complete` event—not merely the object-store request's success—before React is notified.
- The Convex repository combines three reactive queries—plan trees, study log, and preferences—into one domain snapshot.
- Convex mutations authenticate first, walk ownership relationships server-side, and validate semantic limits before writes.

Repository state is explicit: `loading`, `ready`, or `error`. The React provider owns one subscription and distributes state, actions, and mutation failures through separate contexts.

### Optional sync boundary

Local-only mode is the default when `NEXT_PUBLIC_CONVEX_URL` is absent. Its static provider graph contains neither `convex/react` nor `@convex-dev/auth`; it constructs only the local auth facade and IndexedDB repository. The configured Convex client, Auth adapter, and synchronized repository are composed in `src/components/ConfiguredConvexClientProvider.tsx` and reached through a `next/dynamic` import only when the URL is present. This is a client bundle boundary, not a separate build or a claim that Convex is absent from the installed dependencies.

### Features: `src/features`

Features assemble domain data and repository operations into user workflows:

- `today`: current work and progress entry
- `timeline`: date geometry and study-block interaction
- `outline`: course/topic setup and bulk entry
- `planning`: scheduling previews and commit actions
- `shell`: navigation, selection, inspector, sheets, and commands
- `workspace`: ephemeral selection, filtering, command, and reveal state

Timeline and outline are loaded as separate client chunks because either view is expensive and only one is visible at a time.

### Shared UI: `src/ui`

Shared controls own appearance, accessible overlay behavior, keyboard-mode handling, and coordinated motion. Feature code should compose these controls rather than creating private inspector or menu variants.

## Data flow

1. The active repository emits a `PlannerSnapshot`.
2. The repository provider publishes the snapshot once to React.
3. The shell derives focused courses, health, and selection.
4. A feature invokes a repository method.
5. Local mode commits to IndexedDB before notifying; synced mode waits for Convex's reactive query update.

Planning commit uses the repository's `applySchedule` operation. It replaces generated blocks and saves the preferences used to calculate them as one local snapshot commit or one Convex mutation transaction, so observers cannot see blocks calculated from different preferences.

Workspace state such as the selected row or current view is intentionally not persisted with planner data. Appearance and keyboard-mode preferences use browser `localStorage` so they can be applied before hydration.

## Scheduling invariants

- Dependencies are a directed acyclic graph within a course.
- A topic is scheduled only after its dependencies are ready.
- Priority and deadline order decide among currently ready topics.
- Manual blocks are never replaced by automatic reflow.
- Study-day and blackout settings define capacity.
- Preview calculations remain pure; committing a preview belongs to the repository boundary and is atomic through `applySchedule`.

## Transfer format

The writer emits transfer format v3: plans and study history use document-local topic keys instead of database IDs, while preferences and authentication data are omitted. The reader accepts v3 and safely migrates only unambiguous v2 documents. Parsing is intentionally separated from serialization so the Zod validator is downloaded only when a user imports a file. See [data-format.md](data-format.md).

## Testing strategy

Pure domain and non-DOM persistence tests run in Node. Shared UI, the React repository bridge, and feature interaction tests run in jsdom. The suite emphasizes invariants, durable repository behavior, keyboard/ARIA behavior, and regressions at workflow boundaries. Production builds and dependency audits run in CI in addition to lint, type checking, and tests.

## Known scaling boundary

The largest views currently render every visible row; neither Outline nor Timeline is virtualized. The Convex plan-tree query is one reactive client query, but its server function performs indexed fan-out: one plans read, one courses read per plan, exams and topics reads per course, and one blocks read per topic (`1 + P + 2C + T` collection reads for `P` plans, `C` courses, and `T` topics). These are code-structure observations, not measured production latency or a claim that a specific Convex limit has been reached. See the audit for the available development measurements and next profiling steps.
