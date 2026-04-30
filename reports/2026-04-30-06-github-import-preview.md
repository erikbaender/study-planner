# Progress Report 06: GitHub Import Preview

Date: 2026-04-30

## Summary

Added a preview step to the GitHub issue import flow and verified the authenticated server-side import path in the browser.

## Completed

- Added a read-only Convex `previewIssues` action for GitHub imports.
- Kept the existing `importIssues` action as the write path.
- Added a GitHub import preview panel in the modal showing the target plan, repository, issue count, and course-level topic/milestone/range counts.
- Gated the Import button until a preview has loaded.
- Preserved local development behavior: local mode still requires a pasted token and uses the client-side issue fetcher.
- Aligned the local client-side issue fetcher with the Convex importer by paginating through GitHub issues instead of stopping at the first 100.
- Preserved German/source GitHub names in the preview and imported plan.

## Verification

- `pnpm exec convex dev --once --typecheck disable` passed.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm build` passed.
- Re-ran `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm exec convex dev --once --typecheck disable` after the local pagination fix; all passed.
- Browser smoke test in authenticated mode previewed `erikbaender/mhh` without a browser token.
- The preview returned 123 issues grouped into German/source courses including `Physiologie 2`, `Biochemie`, `Physiologie 3`, `OSCE`, `Genetik`, `Psychologie & Soziologie`, and `Physiologie Abschluss`.
- Browser smoke test imported the previewed issues and created a new `mhh import` plan with 7 courses.

## Notes

- The import test intentionally created one `mhh import` plan in the current authenticated dev account.
- Continue using names-only environment checks for Convex/GitHub secrets.

## Next

- Continue UI polish around delete confirmations, empty states, and final CRUD smoke coverage.