# Progress Report 13: Inline Gantt Creation

Date: 2026-07-22

## Summary

Replaced dialog-based Gantt creation with immediate inline milestone and topic-range creation, backed by shared bar visuals and hollow dashed pointer previews.

## Completed

- Added a one-day hollow dashed bar preview under the pointer on blank course and topic tracks.
- Expanded the same preview across the selected dates while dragging.
- Persisted course milestones and topic ranges immediately on pointer release without opening a dialog.
- Made same-day clicks create one-day milestones on course bands and one-day ranges on topic tracks.
- Made multi-day drags create date-spanning milestones and ranges in both directions.
- Rendered milestones and ranges through the same Gantt bar component.
- Changed topic bars to display the topic name and use the parent course color.
- Preserved existing topic-range move and resize behavior and its active dragging state.
- Removed gesture-only dialog draft state and obsolete circular milestone styling.
- Updated the repository workflow to require explicit user approval before merging every pull request.

## Browser verification

- Hovering a blank topic cell displayed a 32px dashed, transparent one-day preview.
- Holding a four-day drag displayed a 158px dashed, transparent preview before release.
- Releasing created the range directly and opened no dialog.
- Topic range bars displayed `Mechanics and heat` and used the Physiology course blue.
- A same-day topic click created a 32px `Repetition` range.
- Same-day and multi-day course-band gestures created 32px and 116px milestone bars.
- The multi-day milestone preview width matched the resulting bar width.
- Resizing an existing range moved its start by one day without opening a dialog or creating another item.
- Dark and light desktop themes rendered the dashed transparent preview correctly.

The existing stacked mobile toolbar/pane layout intercepts chart pointer probes at a 390px viewport. That pre-existing responsive layout behavior is outside this interaction-focused change and was not modified.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```
