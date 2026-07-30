# Phase 4 — Editable outline workflow

## Outcome

Phase 4 turns Outline from a read-only Phase 3 foundation into the planner's permanent setup
surface:

- courses can be created, selected, renamed, and reordered without leaving Outline;
- optional section headings group topics and can be renamed inline;
- topics use an editable Name / Unit / Total / Done / Progress / Status / Exam table;
- Tab follows the table's native cell order;
- Command/Ctrl-Enter inserts a topic after the current row;
- drag handles reorder courses and topics, with equivalent move commands for keyboard users;
- the existing paste-friendly outline parser remains the primary bulk-entry path.

The view stays inside the Phase 4 boundary. Timeline virtualization, generated scheduling,
Reflow, velocity UI, and production import/export work remain in Phases 5–8.

The Phase 5 cleanup pass corrected two Outline regressions found in live use. The wide table is
now a containing block for its screen-reader-only labels, so those absolute elements can no
longer enlarge the root document and create empty vertical or horizontal page scrolling.
Measured-topic status changes now update numeric progress through `logStudy`: Planned maps to
zero, Done to the total, and Active to a valid partial value. Unmeasured topics retain an
explicit status because they have no numeric size from which one can be derived.

## Data integrity

Topic detail updates are partial repository patches, but completion is intentionally excluded
from that patch type. The Done field and progress slider both call `logStudy` with the difference
between the requested absolute value and the current value. This preserves the study log needed
for later velocity and projected-finish calculations.

The repository now exposes `reorderTopics(courseId, topicIds)` alongside course reordering.
Both local and Convex implementations require a complete, duplicate-free list belonging to the
course before assigning new order values. Dropping a topic onto a topic in another section
updates the source topic's section before committing the new order.

## Interaction and accessibility

The editable cells are native inputs and selects with explicit accessible names. Browser-native
Tab order provides predictable cell navigation without a custom grid focus model. Drag handles
are pointer affordances and are omitted from the Tab sequence; the row action menu exposes Move
Up and Move Down, while course menus expose Move Left and Move Right.

Unknown values remain honest: an unmeasured topic keeps an indeterminate progress bar, disables
the Done field, and does not invent a zero-size completion state. Topics without an exam say
“Not set”; provisional exam windows remain visibly marked.

## Verification

Focused repository and component coverage verifies:

- complete and invalid topic reorder lists;
- partial detail edits and section clearing;
- rejection when a total is reduced below logged work;
- the seven-column table and section hierarchy;
- inline detail edits and logged Done deltas;
- measured status changes and their logged progress deltas;
- Command/Ctrl-Enter insertion at the requested position;
- drag reordering;
- direct course creation.

The Chromium workspace journey loads the generated semester and verifies:

- all 44 seeded Biochemistry topic rows render at one consistent height;
- the seven requested columns are present;
- inline insertion, size editing, logged completion, status editing, and drag reorder work;
- the root document remains viewport-sized while the Outline pane owns its real content scroll;
- a course can be created directly in Outline;
- bulk paste adds two parsed topics;
- existing command-palette, Timeline, create-sheet, and inspector navigation still work.

Final validation:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — 16 files, 241 tests
- `pnpm test:e2e` — Chromium, 1 passed
- `pnpm build`

All passed on 2026-07-30. The production build required ordinary network access for the
configured `next/font` Inter download; no application or test workaround was added.

## Handoff

Phase 5 should replace the existing Timeline agenda with the virtualized Gantt described in
`docs/redesign-plan.md` §7.3. Outline is now the editing boundary and should not absorb
scheduling gestures or Reflow. The 400-topic seed and Chromium journey remain the layout and
performance fixtures.
