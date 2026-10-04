# PR #87 usability review

Reviewed on 4 October 2026 against the descriptions and acceptance criteria of all 16 findings in the [original audit](https://github.com/erikbaender/study-planner/blob/main/docs/usability/2026-10-04/report.md), including the original PR changes and the follow-up implementation. Base branch checked: `main` at `41adf8f`.

The remaining implementation gaps were #70, #77 and #78. The PR now includes all three and links all 16 issues with closing references. No merge or premature issue closure was performed.

## Acceptance review

| Issue | Result and evidence |
| --- | --- |
| [#70](https://github.com/erikbaender/study-planner/issues/70) | Fixed. Minute budgets and editable topic throughput preserve material counts. Mixed progress uses estimated time; previews disclose starting estimates. `effort.test.ts` checks daily limits, manual reservations, material totals, zero capacity, shortfalls and mixed legacy-budget refusal. MCP regressions check estimate persistence and undo. |
| [#71](https://github.com/erikbaender/study-planner/issues/71) | Fixed. Generated dependents start after prerequisite finish dates; unresolved or impossible prerequisites produce warnings. Scheduling regressions cover booked prerequisites, unsized prerequisites, and conflicting manual dependent dates. |
| [#72](https://github.com/erikbaender/study-planner/issues/72) | Fixed. Manual dates are preserved, invalid commitments are warned about, and post-deadline work does not satisfy preparation. Scheduling tests cover deadline, unavailable-day and capacity conflicts. |
| [#73](https://github.com/erikbaender/study-planner/issues/73) | Fixed. Browser and MCP record effective bounded deltas. Backend regressions cover positive overflow, negative corrections, log/completion consistency and idempotent retries. |
| [#74](https://github.com/erikbaender/study-planner/issues/74) | Fixed for the existing calendar model. UI exposes account-wide weekdays, blackout dates and timezone; previews show active constraints. Calendar component tests and browser inspection cover the controls; backend rejects invalid timezones. |
| [#75](https://github.com/erikbaender/study-planner/issues/75) | Fixed. Discovery and guide advertise the effective 100-command limit. The exact seven-course/91-topic reproduction returns the expanded count of 106 and actionable batching guidance before mutation. Verified through the SDK/HTTP protocol test. |
| [#76](https://github.com/erikbaender/study-planner/issues/76) | Fixed. Account menu and Commands expose Connected agents; the page displays a copyable canonical MCP URL and setup guidance. Browser verified navigation and copying. Existing protocol tests retain revocation coverage. |
| [#77](https://github.com/erikbaender/study-planner/issues/77) | Fixed. Recent changes shows actor, timestamp, plan and summary with eligible undo. Topic inspector offers dated session entry/correction with duration and notes. Backend tests cover owner isolation, revisions, attribution, latest-change and expiry safeguards; component tests cover form submission and conflict recovery. Browser verified real agent/browser history and saved/corrected sessions. |
| [#78](https://github.com/erikbaender/study-planner/issues/78) | Fixed. Dirty drafts retain their original snapshot, survive remote edits/rejected saves, and provide review/retry/cancel. Inspector regressions verify recovery; backend rejects stale edits. MCP SDK/HTTP tests verify structured conflict metadata without handler traces. |
| [#79](https://github.com/erikbaender/study-planner/issues/79) | Fixed. Manual blocks expose planned material workload and explain the unsized full-day reservation. Inspector tests verify workload edits preserve dates; scheduling tests verify reservations and regeneration behavior. |
| [#80](https://github.com/erikbaender/study-planner/issues/80) | Fixed. German aliases and decimal commas parse correctly; unknown units disclose the selected fallback and block import pending correction. Parser/component tests cover both. Browser imported `Niere — 2,5 Stunden` and `Anki — 100 Karten` as 2.5 hours and 100 cards. |
| [#81](https://github.com/erikbaender/study-planner/issues/81) | Fixed. Copying existing topics is explicitly additive, existing-name matches are previewed, and duplicates require acknowledgment. Covered by topic-creation component tests. |
| [#82](https://github.com/erikbaender/study-planner/issues/82) | Fixed. Zero is honored, preference patches preserve omitted fields, and inconsistent done/completion updates are rejected. Backend and SDK/HTTP tests cover the reproductions and compact errors. |
| [#83](https://github.com/erikbaender/study-planner/issues/83) | Fixed. Unknown observed pace is distinguished from measured delay and the configured-capacity estimate. Domain/Today tests cover unmeasured feasible work and genuinely delayed work; course labels explain their evidence. |
| [#84](https://github.com/erikbaender/study-planner/issues/84) | Fixed. Semester/view state is scoped to account and deployment, waits for a ready snapshot, and recovers from deleted plans. Persistence tests cover those cases; browser reload restored the selected test semester and Outline. |
| [#85](https://github.com/erikbaender/study-planner/issues/85) | Fixed. Empty semesters offer first-course creation; filtered-empty views explain filters. Preview reports excluded unsized topics and says “Sized work fits.” Covered by Today and planning component tests. |

## Review follow-ups

The full review caught and fixed missing throughput persistence in bulk topic creation, missing server-side timezone validation, undo eligibility becoming stale as retention expires, and duplicate React keys for multiple capacity warnings on one topic. Session component and backend regressions were added for consequential behavior. The initially suspected workspace-selection race was not reproduced: the stored semester/view survived reload after initialization completed.

## Independent live retest follow-up

The subsequent [automotive-student SDK/HTTP and browser audit](./pr-87-live-retest.md) found two blockers missed by the initial acceptance review: undo retained newly introduced optional account preferences, and typed numeric edits could save twice and display a false conflict. Both are fixed, covered by eight additional regression cases, and verified against their real MCP/browser reproductions. The initially suspected block-date limitation was disproved after waiting for the asynchronous save; its existing move behavior now has regression coverage.

## Validation and merge assessment

- `pnpm check`: ESLint, TypeScript and **547 tests across 56 files passed**.
- `pnpm build`: passed.
- `pnpm exec convex dev --once`: development backend synced successfully.
- Review included scheduling/metrics, browser/MCP mutation parity, authorization and revision guards, undo payload handling, input/output validation, imports, workspace persistence and the changed UI controls.
- Desktop browser checks used the authenticated non-production deployment through T3 preview at 1280 × 800. Session entry stored material progress, actual minutes and note; correction changed the study date to the previous day while retaining completion. The follow-up report records the broader automotive-student SDK/HTTP and browser scenario and both fixed reproductions; the table above retains the initial acceptance evidence.

No unresolved blocker was found in the 16 issue acceptance criteria. The PR is ready to merge once the final commit's CI and deployment checks pass. Production Convex deployment remains the existing main-branch CI step; the PR workflow skips that step as configured.

Time estimates remain estimates and require calibration by the student or agent. Different capacities per weekday and recurring classes/practicals remain the separate model limitations already identified in #74. Desktop review does not certify mobile behavior, physical-device interactions or every external agent client's connector setup.
