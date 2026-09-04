# Architecture

Study Planner is a client-heavy Next.js application with a pure planning core and one account-owned persistence path.

```text
GitHub sign-in -> Convex Auth -> authenticated repository -> Convex planner API
                                         |
React features -> PlannerRepository -----+----> pure domain calculations
```

## Boundaries

### Domain: `src/domain`

Domain modules know nothing about React or Convex. They own calendar calculations, progress and health metrics, outline parsing, scheduling, shared types, validation, and deterministic sample generation. Scheduling returns an explicit result, including infeasible shortfalls, rather than hiding failure in side effects.

Dates are day-granular ISO calendar strings (`YYYY-MM-DD`). Code must use the helpers in `src/domain/dates.ts`; parsing a date with local-time accessors can introduce timezone shifts.

### Persistence: `src/data` and `convex`

`PlannerRepository` is the application storage boundary. Its sole runtime implementation maps operations to authenticated Convex functions and combines three reactive queries—plan trees, study log, and preferences—into one domain snapshot.

Convex mutations authenticate first, walk indexed ownership relationships server-side, validate semantic limits, and then write. Query and mutation functions use explicit argument and return validators. Atomic operations keep schedule replacement with its preferences and progress changes with their study-log entry.

Repository state is explicit: `loading`, `ready`, or `error`. The React provider owns one subscription and distributes state, actions, and mutation failures through separate contexts. A transient query error emits `error`; a later successful update from that query can return the same mounted repository to `ready`.

### Authentication and provider composition

`ConvexClientProvider` requires both public Convex URLs and fails with setup guidance when either is absent. The provider graph is always:

```text
ConvexReactClient
  -> ConvexAuthProvider
    -> ConvexPlannerAuthProvider
      -> authentication gate
        -> ConvexRepositoryProvider (authenticated only)
```

While auth is loading, the application shows a stable loading screen. Signed-out users see only the GitHub authentication gate. The repository and protected query watches are created only in the authenticated branch; sign-out unmounts them and clears account data from the React tree.

### Features: `src/features`

Features assemble domain data and repository operations into user workflows:

- `today`: current work and progress entry
- `timeline`: date geometry and direct study-block interaction
- `outline`: course/topic setup and bulk entry
- `planning`: scheduling previews and atomic commit actions
- `shell`: navigation, selection, inspector, sheets, account action, and commands
- `workspace`: ephemeral selection, filtering, command, and reveal state

Timeline and Outline are separate client chunks because either view is expensive and only one is visible at a time.

### Shared UI: `src/ui`

Shared controls own appearance, accessible overlay behavior, keyboard-mode handling, and coordinated motion. Feature code composes these controls rather than creating private inspector or menu variants.

## Data flow

1. Authentication resolves successfully.
2. The Convex repository starts the three protected query watches.
3. Once all results are available, the repository emits one `PlannerSnapshot`.
4. The shell derives focused courses, health, and selection.
5. A feature invokes a repository method.
6. The method calls one authenticated Convex mutation; reactive queries publish the committed result.

Workspace state such as the selected row or current view is intentionally not planner data. Appearance and keyboard-mode choices use browser `localStorage` so they can be applied before hydration; they contain no plans, courses, topics, schedule blocks, or study history.

## Scheduling invariants

- Dependencies are a directed acyclic graph within a course.
- A topic is scheduled only after its dependencies are ready.
- Priority and deadline order decide among currently ready topics.
- Moving or resizing a generated block makes it manual.
- Manual blocks are never replaced by automatic reflow.
- Study-day and blackout settings define capacity.
- Preview calculations remain pure; committing a preview is atomic through `applySchedule`.

## Transfer format

The writer emits transfer format v3: plans and study history use document-local topic keys instead of database IDs, while preferences and authentication data are omitted. The reader accepts v3 and safely migrates only unambiguous v2 documents. Parsing is separated from serialization so Zod is downloaded only when a user imports a file. See [data-format.md](data-format.md).

## Testing strategy

Pure domain and Convex adapter tests run in Node. `convex-test` exercises unauthenticated rejection, owner isolation, and persistence across sessions against the real function handlers. Shared UI, the React repository bridge, and feature interaction tests run in jsdom. Production builds and dependency audits run in CI in addition to lint, type checking, and tests.

## Known scaling boundary

The largest views currently render every visible row; neither Outline nor Timeline is virtualized. The Convex plan-tree query is one reactive client query, but its server function performs indexed fan-out: one plans read, one courses read per plan, exams and topics reads per course, and one blocks read per topic (`1 + P + 2C + T`). Measure production query limits and cache behavior before choosing a batched or denormalized read model.
