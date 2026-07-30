# Phase 6 — Scheduling and Today

## Outcome

Phase 6 turns the existing schedule-reading surfaces into a complete planning loop:

- a pure engine generates `auto` blocks from remaining work, exams, capacity, priorities,
  dependencies, study days, blackout dates, and manual placements;
- the Today view previews a different daily capacity without writing it;
- initial planning applies one capacity-aware schedule across the semester;
- Reflow replaces future generated work while retaining manual placements and generated history;
- explicit shortfalls, missing exams, unknown topic sizes, and unknown manual targets stay visible;
- today's generated targets can be completed or logged inline through the study log.

This work continues draft PR #20 from the pushed Phase 5 head `b49e58d`.

## Scheduling engine

`src/domain/scheduling.ts` has no React, repository, network, or clock dependency. Callers inject
`today` and preferences. The engine:

1. chooses each course's earliest upcoming exam, using the start of a provisional window;
2. excludes exam day itself so planned work finishes before the event;
3. calculates remaining measured work and credits future measured manual targets;
4. reserves stated manual capacity before generated work;
5. gives earlier deadlines first claim on the shared daily capacity;
6. allocates higher-priority independent topics first;
7. allocates dependants backwards, then caps prerequisites to an earlier day;
8. emits single-day generated blocks and an explicit per-course result.

An infeasible plan is still useful output. The engine returns the blocks that fit, the exact
unscheduled units, the required daily pace, and an `infeasible` status. Missing or non-positive
capacity emits no blocks. Topics without a tracked size and manual blocks without a target are
counted separately instead of being treated as zero work.

## Reflow integrity

`replaceAutoBlocks` now accepts an optional `fromDate`. Both IndexedDB and Convex:

- preserve every `manual` block;
- preserve `auto` blocks ending before `fromDate`;
- replace only generated blocks at or after the Reflow boundary;
- reject generated blocks outside the explicit topic scope.

The Today action scopes replacement to courses with a deadline, saves the previewed capacity, and
then applies the generated blocks. It never routes through Timeline gestures, and it never changes
a manual block's id, date, or source.

## Today planning loop

The rebuilt Today content adds:

- up to three behind-course recovery banners with Reflow;
- a next-up card using the first scheduled topic for the injected date;
- a checklist that shows logged units against today's target;
- accessible one-click target completion;
- a stepper and Log action for partial work;
- a What-if daily-capacity preview with explicit infeasibility detail;
- initial Auto-plan and subsequent Reflow actions;
- on-track/behind status beside the next three exams.

The What-if input is local draft state. Preferences and blocks change only after the explicit
apply action. At 400 units/day the seeded development plan honestly reports a 974-unit shortfall
rather than claiming that all work fits.

## Browser cleanup

The first live generated schedule exposed a layout-only regression that unit tests could not see.
Visually hidden checkbox labels were absolutely positioned against the document, extending the
root page below the viewport when Today contained enough rows. Completion controls now carry an
explicit accessible name and omit the redundant hidden label node.

The shared browser verified:

- the page renders without a framework or application error;
- Auto-plan creates eight targets for the seeded current day;
- Reflow remains available after application;
- the explicit shortfall remains visible;
- checkbox names are present in the accessibility tree;
- at both 1280×800 and 1024×768, root width and height equal the viewport;
- the content `<main>` owns the legitimate vertical scroll;
- a fresh tab reports only the development HMR connection and no console errors.

Playwright now reuses a confirmed local Study Planner server outside CI. CI continues to start a
clean server and never reuses another process.

## Verification

Focused coverage includes:

- backwards scheduling and exam-day exclusion;
- weekdays and blackout dates;
- priority under scarce capacity;
- topological dependency order;
- measured and unmeasured manual placements;
- exact infeasibility and unknown capacity;
- no-deadline, completed, unmeasured, and provisional cases;
- deterministic, non-mutating output;
- manual and past-generated preservation across repository Reflow;
- Today preview, logging, target completion, Reflow, and unknown-capacity UI.

Final validation on 2026-07-30:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — 20 files, 266 tests
- `pnpm test:e2e` — Chromium, 1 passed
- `pnpm build`

## Handoff

Phase 7 owns full exam management, study-history presentation, and velocity/projection detail.
Reuse `assessCourse` and the existing repository methods. Keep progress mutations on `logStudy`,
keep provisional dates explicit, and do not move scheduling heuristics out of
`src/domain/scheduling.ts`.
