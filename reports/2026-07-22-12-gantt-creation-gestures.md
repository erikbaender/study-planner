# Progress Report 12: Gantt Creation Gestures

Date: 2026-07-22

## Summary

Added direct milestone and study-range creation to blank Gantt timeline cells, with contextual dialogs prefilled from the selected dates.

## Completed

- Added a creation gesture state that remains separate from existing range move and resize state.
- Made blank course and topic timeline cells clickable for same-day milestone creation.
- Made blank topic timeline cells draggable for normalized multi-day range creation.
- Added an aligned live preview while a creation gesture is active.
- Added contextual milestone and range dialogs that identify the selected course/topic and summarize the selected dates.
- Kept dates editable before saving.
- Prevented existing milestones and ranges from triggering creation gestures.
- Preserved local and Convex creation paths by routing dialogs through the existing mutations.
- Verified responsive dialog rendering in dark and light themes.

## Browser verification

- Clicking a blank course day opened a milestone dialog with the exact selected date.
- Dragging across four blank topic days opened a range dialog with normalized start/end dates.
- Dragging backward across day cells produced the same chronologically normalized date span.
- Saving the range added one chart bar and one inspector entry.
- Dragging an existing range moved it without opening a creation dialog.
- The milestone dialog fit a 390 x 844 viewport without horizontal overflow.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
```
