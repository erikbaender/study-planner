# PR #87 live automotive-student retest

**Updated assessment: the two confirmed blockers are fixed and their live reproductions pass.** Merge remains conditional on the updated commit’s CI and deployment checks. The initial audit below found broken preference undo and a reproducible false conflict during ordinary manual editing; the follow-up adds fixes and regression coverage.

Tested 4 October 2026 at commit `794e82f18b1dd5e4118c84f8a72da473fd7579fa`, on branch `fix/usability-audit`, through the running development app at `http://localhost:3000` and its configured development Convex deployment. [PR #87](https://github.com/erikbaender/study-planner/pull/87) had successful CI and deployment-preview checks.

## Student scenario

Created **Automotive Engineering — PR87 acceptance test** using the real remote MCP endpoint, after metadata discovery, public-client registration, browser consent and PKCE token exchange. Calls used the installed MCP SDK over Streamable HTTP, including actual initialization, tool discovery and guide-resource reading; planner mutations were not simulated or sent directly to Convex.

The semester has four courses: Engineering Thermodynamics, Vehicle Dynamics, Electric Powertrains, and Automotive Materials and Lab. It contains four exams/deadlines, twelve topics, six prerequisite links, and two fixed manual bookings. Material includes slides, pages, videos, cards, exercises and hours, with explicit throughput estimates. Eleven sized topics total 1,510 estimated minutes; one optional reading topic intentionally has no size.

Initial request: two hours per weekday in Europe/Berlin, no study on 12 October, and preserve the lab and suspension bookings. Follow-up requests brought the thermodynamics exam forward, increased the heat-transfer estimate/priority, reduced capacity to 90 minutes, tested zero capacity, and previewed an impossible deadline.

## Initial findings (before fixes)

### P1 — Undo silently retains a newly introduced account-wide preference

1. Start with an existing preferences document containing `dailyCapacityUnits: 60` and no `dailyCapacityMinutes`.
2. Apply `preferences.update` with `dailyCapacityMinutes: 120`, followed by schedule regeneration.
3. Read history and undo that latest eligible transaction using its current revision.
4. Read preferences again.

Expected: the original preferences, including the absence of `dailyCapacityMinutes`, are restored. Actual: undo succeeds, removes the generated schedule, restores weekdays/blackouts, but leaves `dailyCapacityMinutes: 120` in the document. The new value takes precedence over the original legacy capacity, changing scheduling semantics for every semester in the account.

Observed at plan revisions 1 → 2 → 3. The SDK readback failed an exact comparison with the original preferences. Undo of a later 120 → 90 change correctly restored 120, so the failure specifically concerns fields previously absent.

The inverse captures optional fields in [plannerApplication.ts](../../../convex/plannerApplication.ts#L794). Persistence omits undefined properties; [the restoration patch](../../../convex/plannerApplication.ts#L893) spreads the stored object without explicitly removing newly introduced fields. Restoration needs to clear absent optional fields, with a regression using an existing legacy preferences document.

### P2 — Typing a time estimate and pressing Tab produces a false concurrent-edit warning

With no concurrent agent or browser changes, select Battery safety and BMS flashcards, replace its minutes-per-card estimate from 1.5 with 2, and immediately press Tab.

Actual: the value is saved and the plan advances from revision 22 to 23, but the browser displays: “This semester changed elsewhere. Your edit was not saved. Review the latest version, then retry or cancel your draft.” MCP readback confirms that the estimate is already 2. An earlier ordinary estimate edit produced the same warning.

[Stepper](../../../src/ui/toggles.tsx#L164) invokes its write callback on change and again on blur. These saves can race using the same displayed revision; the second save conflicts with the first. The new inspector estimate control uses this behavior for a revision-checked backend write. Commit once, avoid unchanged writes, or serialize/rebase pending edits. This path also lacks the text field's Review/Retry recovery controls.

Screenshot of the false warning: `/home/erik/.t3/userdata/browser-artifacts/browser-screenshot-localhost-muu084n5-e1cf485b.png`.

### Corrected observation — moving a single-day block

The initial audit reported that moving a single-day block later required changing Ends before Starts. Follow-up browser testing disproved that conclusion. Changing Starts from 20 to 22 October shifted both dates to 22 October, preserving the manual block ID and 20-card workload; changing Starts back restored both dates. Immediate DOM readback briefly showed the old controlled value while the asynchronous save was pending. Settled UI and MCP readback confirmed the move. A regression now verifies this existing behavior; no date-handling change was needed.

## Verified behavior

| Workflow | Live result |
| --- | --- |
| Connection setup | Connected agents was discoverable; Copy URL showed the canonical local MCP URL; OAuth consent, initialization and resource/tool discovery succeeded. |
| Multi-course creation | All courses, assessments, topic units/counts, estimates, dependencies and bookings round-tripped and appeared in the browser. |
| Initial scheduling | Preview wrote nothing; apply generated 17 automatic blocks. Independent checks passed for weekday/blackout constraints, daily totals ≤120 minutes, prerequisite ordering, material coverage and preserved manual IDs/dates. |
| Requested MCP changes | Exam date, priority and throughput updates persisted. Partial capacity patches preserved other settings. Reduced capacity warned about the oversized manual lab commitment. An impossible deadline reported unallocated minutes. |
| Retry/conflict behavior | Identical successful requests returned the same result. A stale request returned structured `REVISION_CONFLICT`, expected/current revisions and intervening summary. |
| Progress | Browser logged 30 cards, 45 minutes and a note; session correction moved its date to 3 October without changing completion. MCP overflow recorded only the effective remaining 90 cards; retry added no duplicate; undo restored 30 completed cards. |
| Manual browser edits | Renaming, throughput editing, notes, manual block creation/workload/date changes persisted and were readable over MCP. Numeric edits had the initial P2 warning, resolved in the follow-up below. |
| Concurrent browser draft | Unsaved notes survived an MCP edit of the same field. Review showed the saved agent text; editing the draft and Retry saved the combined text. |
| History and undo | Browser history attributed agent/user changes correctly; eligible browser block undo restored its prior dates/workload. Preference undo initially had the P1 exception, resolved below. |
| Zero capacity | Preview/apply produced no automatic allocations and preserved all manual blocks; undo restored the prior explicit capacity and automatic schedule. |
| Web Reflow | Displayed estimates, unsized-work exclusions and manual prerequisite warnings; applying preserved all three manual bookings. |
| Reload | The selected automotive semester and Timeline/Week view were restored. |
| Token lifecycle | The 15-minute access token expired; refresh restored access. Browser revocation removed the connection; subsequent MCP initialization returned HTTP 401 and refresh returned `invalid_grant`. An already-open transport after revocation was not verified. |

## Initial validation and cleanup

- The test invocation completed the entire existing suite: **539 tests across 56 files passed**. No new regression tests or product fixes were added during this review.
- Original account preferences were restored exactly and verified by MCP readback. Because normal Undo could not remove the added field, cleanup used a temporary guarded internal mutation on the development deployment; that function was removed and the original backend source redeployed afterward.
- The test connection was revoked. Temporary OAuth credentials were removed. The labelled test semester remains available for inspection; existing semester content was not edited.
- This verifies the SDK/HTTP integration and desktop web interface on the development deployment. It does not certify production, mobile interaction, or connector setup in a separate external AI client.

## Fixes, review and live follow-up

- **P1 fixed:** preference restoration explicitly patches all three optional fields (`dailyCapacityUnits`, `dailyCapacityMinutes`, `timezone`). An absent stored inverse value now deletes the field instead of leaving a later value behind. Owner, plan revision, preference revision, eligibility and expiry guards remain enforced. Three backend regressions cover legacy-only, minute-only and neither-capacity documents, including persisted inverse serialization and exact field absence.
- **P2 fixed:** persisted inspector steppers keep a local typing draft and commit on blur or Enter. Unchanged values produce no write; Escape cancels; a pointer arrow adjustment consumes the typed draft in one save. Topic totals, throughput estimates and manual planned workloads use this mode. Existing immediate callbacks remain available for local previews. Component regressions cover delayed prop acknowledgment, unchanged/cancelled edits, typed-plus-arrow saves, and inspector integration.
- Regression validation against the original code failed for both confirmed bugs; the fixed code passes. `pnpm check` passes ESLint, TypeScript and **547 tests across 56 files**. `pnpm build` passes. `pnpm exec convex dev --once` compiled and synced the fixed backend.
- **Live MCP P1 retest:** a fresh OAuth connection used the actual SDK/Streamable HTTP endpoint. Starting at revision 30 with no minute capacity, preview/apply set 120 minutes, weekdays and a blackout, then regenerated the schedule. Undo at revision 32 restored the exact original preference object and all semantic schedule fields. No cleanup mutation was needed. Restored automatic blocks receive new IDs as designed; manual IDs remain stable.
- **Live browser P2 retest:** Battery safety and BMS flashcards changed from 1.5 to 2 minutes/card and immediately tabbed out. MCP readback confirmed exactly one revision advance (32 → 33); the settled inspector showed 2 and no alert. Typing 1.5 again left the backend at revision 33/value 2 until Tab; afterward revision 34/value 1.5 confirmed one save. The subsequent date move and restoration passed at revisions 35/36 without alerts.
- Focused backend review checked optional-field persistence, atomic undo order, ownership and revision safeguards. React review checked controlled drafts, hook use, keyboard commit/cancel, pointer adjustment and bounds. No further blocker was found within the tested desktop/MCP workflow.

Original account preferences, topic estimate and the manual booking are restored. The labelled test semester remains available for inspection. This follow-up verifies development SDK/HTTP and desktop browser behavior; production, mobile and separate external AI-client connector setup remain outside the tested scope.

