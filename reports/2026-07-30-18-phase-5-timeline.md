# Phase 5 — Virtualized Timeline

## Outcome

Phase 5 replaces the read-only chronological agenda with the planned Gantt workspace:

- TanStack Virtual limits both course/topic rows and calendar columns to the viewport plus
  overscan;
- Day, Week, Month, and Quarter zoom levels change scale and drag snapping;
- the first view centers today instead of opening on an empty early-semester range;
- course swimlanes collapse and carry aggregate schedule/progress bars;
- topic blocks show internal completion, with a distinct indeterminate treatment when size is
  unknown;
- confirmed exams use flag rules and provisional exams use hatched date bands;
- dependency curves are visible by default and can be toggled off;
- block clicks open an anchored quick-edit popover.

The generated sample has 354 Timeline rows. At a 1280×800 viewport the browser mounted 21 rows
at once while the ARIA grid retained the complete row count. The 15,610px virtual row extent
remained inside the grid; the root document stayed exactly viewport-sized.

## Interaction and data integrity

Pointer movement below 4 px remains a click. Once the threshold is crossed, the active bar
previews its snapped position directly in the DOM so pointer movement does not rerender the
full Timeline. Releasing writes through `updateStudyBlock`. A moved generated block therefore
becomes manual at the repository boundary and will be protected from the Phase 6 Reflow.

Shift-click builds a multi-block selection and dragging a selected member moves the group by
the same delta. Left/Right moves the focused block by the current zoom unit; Alt-Left/Right
resizes its end. Pointer cancellation discards the preview. Clicks without a drag select the
topic and open a Radix popover where start, end, and target units can be edited.

The screen-reader label for every block includes topic, date range, progress certainty, and
source. The canvas reports an ARIA grid with row/column totals, course and topic row headers,
focusable block cells, and accessible exam/today markers.

## Outline cleanup included

The cleanup requested before Phase 5 found that Tailwind's `sr-only` absolute positioning was
not locally contained inside the wide Outline table. The labels were visually clipped but
still expanded the HTML document from 1280×800 to 1330×2096, producing the empty horizontal
and vertical page scroll ranges. Positioning the table establishes the missing containing
block; the same browser measurement is now 1280×800 while the main pane owns the legitimate
Outline content height.

The status menu also now follows the same progress-integrity rule as the Done field and slider.
For measured topics, Planned logs back to zero, Done logs to the total, and Active preserves or
creates a partial value. Direct `completedUnits` patches remain impossible. Topics without a
size keep explicit status editing because there is no numeric progress to synchronize.

## Verification

Focused tests cover:

- padded Timeline ranges and day offsets;
- zoom-specific drag snapping and date preservation;
- tick boundaries for all four zoom levels;
- virtual grid semantics, zoom, course collapse, progress, today, and exam markers;
- shift multi-selection without accidentally opening another popover;
- keyboard move/resize and the anchored editor;
- sub-threshold pointer movement and committed drag movement;
- bidirectional Outline status/progress synchronization.

The Chromium journey verifies the full Outline-to-Timeline handoff against IndexedDB, including
root-axis containment, measured status synchronization, more than 300 logical Timeline rows
with only a viewport subset mounted, today visibility, and real course collapse.

Final validation on 2026-07-30:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — 18 files, 248 tests
- `pnpm test:e2e` — Chromium, 1 passed
- `pnpm build`

## Handoff

Phase 6 owns scheduling and Reflow. Keep its engine pure in `src/domain/scheduling.ts`, inject
today and preferences, write generated placements through `replaceAutoBlocks`, and prove that
manual blocks survive. Timeline should remain the editing/visualization boundary rather than
absorbing scheduling heuristics.
