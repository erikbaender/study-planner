# Progress Report 08: GitHub Subissue Import Filter

Date: 2026-04-30

## Summary

Corrected the GitHub sample importer so progress subissues are not imported as standalone study topics.

## Completed

- Added filtering for GitHub issues titled like `Teil ...` when they do not include a date range.
- Applied the filter in both import paths:
  - Convex server-side preview/import actions.
  - Local browser GitHub import fallback.
- Added `skippedSubissueCount` to GitHub preview/import results.
- Updated the GitHub import modal and success toast to show skipped progress subissues.
- Removed authenticated auto-seeding of starter sample data so clean dev-account reimports stay clean.
- Created GitHub issue #1 to track the work now that MCP issue creation is available.

## Dev account data

- Removed the previous 123-issue `mhh import` plan from the authenticated dev account.
- Verified the account stayed empty after deletion, confirming starter auto-seeding no longer runs.
- Imported the corrected `erikbaender/mhh` sample data.
- Verified the account now contains one `mhh import` plan with 7 courses and 89 imported issues.
- Verified the preview and toast report 34 skipped progress subissues.

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm exec convex dev --once --typecheck disable
pnpm exec convex run github:previewIssues '{"owner":"erikbaender","repo":"mhh"}'
```

The Convex preview returned 89 importable issues and 34 skipped progress subissues.