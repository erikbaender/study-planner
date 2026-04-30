# Progress Report 09: Gantt Usability

Date: 2026-04-30

## Summary

Started regular feature-branch work for the next usability slice. This branch focuses on the broken Gantt viewport, course folding, drag performance, side-pane space, and the incorrect imported date fallback.

## Completed

- Created GitHub issues for the requested backlog:
  - #2 Correct GitHub issue date extraction for imported study ranges.
  - #3 Make left and right planner panes collapsible.
  - #4 Use distinct icons for courses and topics.
  - #5 Fix unusable Gantt layout, scrolling, and drag performance.
  - #6 Add dark mode with an in-app toggle.
- Pushed `main` so feature branches start from the shared MVP plus subissue-filter fix.
- Created branch `fix/gantt-layout-performance`.
- Changed the app shell to use a viewport-bounded layout instead of letting Gantt rows stretch the whole page.
- Made the Gantt pane own vertical scrolling for its rows.
- Added collapsible course groups in the Gantt chart.
- Added controls to collapse and reopen the left navigation pane and right inspector pane.
- Swapped the empty-course icon to a course-level graduation cap so courses and topics no longer share the same book symbol.
- Changed Gantt drag/resize so pointer movement previews locally and persists only once on pointer release.
- Changed Gantt bars to show the course name instead of the date range text.
- Stopped using milestone due dates as fallback topic study ranges during GitHub import.

## Date import finding

The private `erikbaender/mhh` issue REST data exposes empty issue bodies for sampled topics and only milestone due dates for the course/exam date. Those milestone due dates are not topic study ranges, so the importer no longer uses them as range fallbacks.

The likely source of the real Gantt dates is GitHub Projects v2 date fields. The current import token can read issues but cannot read Projects v2 data; GitHub GraphQL returns `Resource not accessible by personal access token` for repository project access. Issue #2 should stay open until a token with project read access is available or another source for the original Gantt dates is identified.

## Browser verification

- Body height remains bounded to the viewport.
- Gantt scroller is bounded inside the main pane with internal vertical scrolling.
- Course folding reduced visible topic rows for the selected course.
- Left and right pane collapse controls expand the Gantt pane.
- First visible Gantt bar showed the course name as its label.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm exec convex dev --once --typecheck disable
pnpm exec convex run github:previewIssues '{"owner":"erikbaender","repo":"mhh"}'
```

The refreshed Convex preview returned 89 importable issues, 34 skipped progress subissues, and 0 imported ranges because issue-level dates were unavailable through the current token.