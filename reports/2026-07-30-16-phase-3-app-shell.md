# Phase 3 — Navigation split-view app shell

## Outcome

Phase 3 replaces the interim application route with a persistent macOS-style
workspace shell:

- a semester and smart-view source-list sidebar;
- Today, Timeline, and Outline content modes;
- a contextual course/topic inspector;
- a unified toolbar with view switching, create, import/export, appearance,
  authentication, and inspector controls;
- a searchable command palette for views, actions, courses, and topics;
- the documented keyboard map: Command/Ctrl-K and Command/Ctrl-F search,
  Command/Ctrl-1/2/3 views, Command/Ctrl-N create, Option/Alt-Command/Ctrl-I
  inspector, Command/Ctrl-Backspace delete, and Space quick look.

Zustand owns only ephemeral workspace state. Repository data and mutations
remain behind `PlannerRepository`, preserving the Phase 1 boundary.

## Scope boundaries

The three content modes are intentionally honest foundations for later phases:

- Outline carries the existing exam, progress, and bulk-entry functionality
  into the feature structure. Phase 4 still owns inline table editing,
  reordering, and the permanent outline workflow.
- Timeline exposes existing study blocks as a keyboard-reachable ARIA grid.
  Phase 5 still owns the virtualized Gantt, zoom, markers, and drag behavior.
- Today exposes scheduled work, upcoming exams, and behind-course summaries
  from data the app already has. Phase 6 still owns scheduling and Reflow.

No scheduler behavior or inferred plan was introduced in the shell.

## Handoff verification

Before extraction, the sample Biochemistry outline was checked in Chromium:
44 topic rows rendered in the expected name → slider → count → actions order,
and the first eight rows shared the same height. The completed Playwright
journey repeats that row-count and uniform-height guard before exercising the
new navigation.

## Tests and validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — 15 files, 233 tests
- `pnpm test:e2e` — Chromium workspace journey
- `pnpm build`

All passed on 2026-07-30.

The browser journey covers a cold local start, sample loading, sidebar course
navigation, all 44 Biochemistry rows, command-palette course navigation,
Timeline switching, New Item, and inspector toggling.

## Project tracking and access

GitHub issue #21 tracks this slice and is attached to the private
`Study Planner` project as P0 / M / In progress. The refreshed GitHub token
includes the `project` scope, so Projects v2 fields can be read and updated.
No Convex deployment or authentication secrets were needed; signed-in
end-to-end behavior remains outside this local test.
