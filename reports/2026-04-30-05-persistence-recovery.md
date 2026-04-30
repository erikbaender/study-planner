# Progress Report 05: Persistence Recovery and Edit/Delete Controls

Date: 2026-04-30

## Summary

Recovered after the Codespace crash, verified that the Convex persistence work had survived, and added the first edit/delete surface for planner entities.

## Completed

- Re-anchored from the actual workspace state after the crash.
- Confirmed `StudyPlannerApp` is wired to Convex for authenticated users while keeping local development mode available.
- Confirmed `convex/planner.ts` includes full-tree plan loading and batch plan-tree import/seed support.
- Added Convex update/delete mutations for plans, courses, topics, milestones, and topic ranges.
- Added cascading deletes so removing a plan, course, or topic also removes dependent records.
- Added dependency cleanup when deleting a topic, so sibling topics do not keep stale dependency IDs.
- Added inspector edit/delete controls and range-level edit/delete controls in the UI.
- Added modal support for editing existing plans, courses, topics, milestones, and ranges.
- Added dependency editing for topics, backed by the existing Convex cycle validation.
- Adjusted GitHub issue import mapping to preserve original German issue titles, milestones, labels, and body text without translating or replacing them with English notes.
- Added a Convex GitHub import action so authenticated users can import issues with a server-side token instead of pasting a token into the browser.
- Set `GITHUB_IMPORT_TOKEN` in the Convex dev deployment from the available Codespace issues-read secret without printing the value.
- Kept local development mode as the fallback whenever GitHub sign-in is unavailable or not needed for testing.

## Verification

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm build` passed.
- `pnpm exec convex dev --once --typecheck disable` passed.
- Verified Convex env names only and confirmed `GITHUB_IMPORT_TOKEN` is present.
- Browser smoke test in local development mode confirmed the planner loads and a course can be edited through the new inspector control.
- Browser smoke test in local development mode confirmed the dependency editor opens with existing dependencies selected and saves cleanly.

## Notes

- GitHub OAuth was already verified earlier; future browser checks should use local development mode if GitHub asks for sign-in again.
- Authenticated Convex persistence still needs another browser smoke test when an active GitHub session is available, but command-level Convex validation is clean.

## Next

- Continue broadening CRUD ergonomics and polish empty/error/loading states.