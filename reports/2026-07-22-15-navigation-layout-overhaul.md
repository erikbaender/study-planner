# Progress Report 15: Navigation And Layout Overhaul

Date: 2026-07-22

## Summary

Replaced the persistent three-panel planner shell with a single central Gantt workspace and a command-style plan navigation control.

## Completed

- Removed the permanent left navigation panel, right inspector panel, center toolbar, and center-panel title/subtitle.
- Added one centered plan command control that displays the active plan name.
- Added a GitHub-inspired plan picker popup with selectable existing plans and a footer action to create a plan.
- Changed the plan-creation popup to request only the plan name.
- Moved Gantt item details from the inspector into a reusable detail popup with edit, delete, and contextual actions.
- Centralized popups on the shared `Dialog` component, including a consistent header close icon.
- Added shared popup animations: enter from below the center and exit toward the top.
- Removed obsolete header import/export controls that no longer fit the single-command navigation model.

## Validation

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm build` passed.
- Browser validation on port 3000 confirmed one header control, no side panels, no planner toolbar, the plan picker flow, name-only plan creation, and Gantt milestone details in a popup.
- Closing the detail popup left no active modal and retained the Gantt workspace.
