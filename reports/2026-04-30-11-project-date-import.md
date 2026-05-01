# Progress Report 11: Project Date Import

Date: 2026-04-30

## Summary

Fixed the remaining GitHub import date issue by reading real study ranges from GitHub Projects v2 fields when a Projects-capable token is available.

## Completed

- Verified the new `PROJECTS_ACCESS` token can read the private `erikbaender/mhh` GitHub Project.
- Identified the source project as `Lernplan` with `Start date` and `Target date` fields.
- Added Project v2 date enrichment to the local browser import helper.
- Added Project v2 date enrichment to the Convex GitHub preview/import action.
- Added `GITHUB_PROJECTS_TOKEN` support for Convex imports, falling back to the issue import token when no separate Projects token is configured.
- Set `GITHUB_PROJECTS_TOKEN` on the Convex dev deployment.
- Kept milestone due dates as milestones only; they are not used as topic range fallbacks.
- Updated README setup notes for Projects v2 date imports.

## Data verification

The refreshed Convex preview for `erikbaender/mhh` returned:

- 89 importable issues.
- 34 skipped progress subissues.
- 86 imported topic ranges from Project v2 date fields.

Three importable topics do not expose Project date fields in the available data and therefore import without ranges:

- `#108 Herz 1`
- `#109 Herz 2`
- `#89 Wiederholung`

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm exec convex dev --once --typecheck disable
pnpm exec convex run github:previewIssues '{"owner":"erikbaender","repo":"mhh"}'
```