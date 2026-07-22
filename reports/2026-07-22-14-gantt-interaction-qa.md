# Progress Report 14: Gantt Interaction QA

Date: 2026-07-22

## Summary

Completed a focused QA pass on inline Gantt creation and existing topic-range manipulation.

## Fixed

- Restored clearly visible left and right resize handles on topic bars with an explicit stacking layer.
- Prevented same-row overlaps while creating topic ranges and course milestones.
- Clamped topic-range movement while preserving the bar duration.
- Clamped start and end resizing against the nearest neighboring range.
- Replaced the chart crosshair with the standard pointer cursor.
- Standardized real and preview bars to 6px insets on every side of a 44px row.
- Matched preview height, width, and 8px corner radius to real bars.
- Reduced the dashed preview border to 1px.
- Removed milestone and range buttons from the chart toolbar and inspector.

## Browser verification

- Real bars measured 6px from the top, bottom, left, and right date-cell boundaries.
- Preview bars measured the same 6px insets and used a 1px dashed border.
- Both topic handles rendered at 8 x 22px with `z-index: 2`.
- Extending a May 18-25 range toward a June 12 range stopped on June 11.
- Extending the June 12-15 range backward stopped on May 26 after the earlier bar.
- Moving that eight-day range toward the June 12 range stopped at June 4-11.
- Creating across the occupied June 12-15 interval stopped at June 11 and produced no overlap.
- Reverse creation across the May 18-25 interval stopped at May 26 and produced no overlap.
- Milestone and range action buttons were absent from both toolbar and inspector.
- The chart creation cursor computed to `pointer`.

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```
