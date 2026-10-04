# MHH fourth-semester usability test — 4 October 2026

**Completed:** desktop and authenticated MCP task testing, fresh sign-in verification, read-only permission testing and cleanup are complete. Sixteen findings are documented below. No product code was changed.

The principal problem is trust in the generated schedule: workload arithmetic and several scheduling constraints can produce a plan that looks feasible but does not represent what the student can actually complete. The integration is technically usable, but the browser offers little help connecting an agent, understanding its changes, or recovering from them.

## Scope and method

- Commit `e3d0b30`, this worktree at `http://localhost:3000`, existing non-production Convex deployment `proper-elk-932`.
- Account requested by the user, verified in the toolbar and account settings. Mutations were confined to named `[USABILITY TEST]` semesters; original coursework was not a test target.
- T3 collaborative Chromium preview at **1280 × 800**. Desktop only, following the user's clarification. Mobile observations are excluded.
- Expert usability walkthrough and realistic task simulation; no actual student participants. Severity describes impact on the requested LLM-first workflow, not measured frequency among students.
- The persona is a German medical student in the second study year, planning physiology, biochemistry, psychology/sociology, human genetics and diagnostic-methods/OSCE preparation. These subjects match the [MHH second-year module list](https://www.mhh.de/medizinstudium/studienjahr2). MHH uses a model curriculum with quintiles; this test does not assume a generic nationwide Physikum plan. [MHH study structure](https://www.mhh.de/medizinstudium/allgemeine-informationen)
- All test exam dates and workloads are synthetic and relative to the current date; none are asserted to be official MHH dates. The primary scenario has five courses, 13 topics, overlapping exam dates, a provisional OSCE window, prerequisite links, mixed materials and a booked study-partner session.
- MCP was exercised through actual HTTP JSON-RPC calls to `/mcp`, using dynamically registered clients, browser consent and PKCE. No direct database writes or authentication bypass were used. This covers the remote protocol and an LLM agent's tool workflow; it does **not** certify connector setup in every named LLM product.
- Timeline movement/resizing attempts used pointer events through T3's page-evaluation tool. File-import tests used real `File` objects and the UI input's change event. Date typing was unreliable in preview automation; a date change was verified through the browser and the stored exam. These are not a substitute for physical mouse/device testing.

## Task results

| Task | Outcome |
| --- | --- |
| Discover MCP, register client, consent and exchange PKCE code | Passed with an existing signed-in session |
| Initialize, read guide, enumerate tools | Passed: all eight advertised tools |
| Create five-course semester and retry identical create | Passed: one plan, stable returned ID |
| Create realistic seven-course/91-topic semester atomically | Rejected by internal expansion cap; F06 |
| Preview major edits without writing | Passed: revision stayed unchanged |
| Apply edits, retry, reject stale revision | Passed |
| Paginate history and undo latest eligible transaction | Passed; browser has no equivalent recovery UI |
| Record dated progress with minutes/note; retry | Passed |
| Correct progress past valid bounds | Accepted with inconsistent stored log; F04 |
| Reject invalid dates, dependency cycles, cross-course links, completedUnits above total | Passed |
| Schedule with no study days or low capacity | Explicit shortfall warnings returned |
| Manual prerequisite moved beyond dependent work | Incorrect schedule with no warning; F02 |
| Manual work moved beyond its exam | Accepted and still subtracted from work needing scheduling; F03 |
| Browser rename, priority edit and manual block creation | Passed; MCP saw changes |
| Browser save after concurrent agent edit | Correctly rejected; recovery UX fails F09 |
| Timeline move of generated block | Passed: dates changed and block became manual |
| Manual semester/course creation, bulk topics, exam, Auto-plan | Passed |
| Completion checkbox forward and reverse | Passed: +40 and -40 logged, completion returned to zero |
| JSON export; invalid import; valid additive import | Passed: v3 export, clear invalid-JSON error, fresh IDs and matching imported courses/history |
| OAuth refresh before revocation | Passed |
| Revoke through `/connections`; read, write and refresh afterward | Passed: read/write HTTP 401, refresh HTTP 400 `invalid_grant` |
| Fresh email-code delivery | Passed: requested message arrived in the specified inbox |
| Fresh email-code verification | User completed the code dialog; requested account verified afterward |
| Read-only OAuth scope | Read passed; write rejected with insufficient-scope error; [evidence](evidence/readonly-scope.json) |
| Revoke final read-only grant | Read HTTP 401; refresh HTTP 400 `invalid_grant`; [evidence](evidence/readonly-revocation.json) |
| Delete temporary semesters and verify baseline | Passed through UI; one original semester remains, no test study logs; [evidence](evidence/cleanup.json) |

## Prioritized findings

P1 means it can invalidate the core plan or prevents an important part of the specified workflow. P2 is significant friction or a narrower bug. P3 is a minor usability problem. Product limitations are identified separately from implementation bugs.

### F01 — P1: mixed units make capacity and feasibility advice unreliable

**Reproduce:** create topics measured in slides, pages, cards, hours and items; set daily capacity to 60; generate the initial schedule. Four hours of OSCE practice, two hours of rehearsal and question/slide work can all share a day because the scheduler adds their raw numbers. The manual-only course also fitted 176.5 mixed units into three study days.

**Impact:** “60 units per day” has no stable meaning to someone combining Anki, lecture slides, reading and practical training. A plausible-looking semester can overbook actual time. Course progress and “units left” also add heterogeneous materials numerically.

**Cause:** [scheduler](../../../src/domain/scheduling.ts) uses one numeric capacity for every topic. This is a domain-model limitation affecting both MCP and UI, not an LLM prompt error.

**Acceptance:** represent time/effort separately from material counts; use topic-specific throughput estimates or explicit planned minutes. Preview and daily workload should express a common time budget while preserving material units.

### F02 — P1: dependencies do not enforce calendar precedence

**Reproduce:** `Anamnese mit Lernpartner` is a two-hour manual prerequisite of `Körperliche Untersuchung`. Preview moving the prerequisite from 7 to 26 October, followed by regeneration. The dependent remains scheduled on **10 October**, with no warnings. [Response](evidence/dependency-preview.json)

**Impact:** the student can be told to do work before the preparation or partner session on which it depends.

**Cause:** dependency order controls the allocation queue, while every allocation starts again at `today`; manual prerequisite dates do not establish an earliest start.

**Acceptance:** dependent blocks must respect prerequisite completion/booked finish dates, or preview must explicitly report an unsatisfied dependency instead of advertising a valid schedule.

### F03 — P1: manual commitments after the exam can hide missing preparation

**Reproduce:** preview moving the two-hour OSCE prerequisite to **20 November**, after the provisional exam starts on **10 November**, then regenerate. It is accepted, warnings remain empty, and those two hours are still treated as covered. [Response](evidence/manual-after-exam.json)

**Impact:** preserving the student's manual commitment is reasonable; silently counting it as pre-exam preparation is misleading.

**Acceptance:** keep manual blocks, but flag commitments beyond the relevant deadline, unavailable days and capacity conflicts. Work booked after the deadline must remain a pre-deadline shortfall unless the user deliberately changes the goal.

### F04 — P1: out-of-range progress stores a different delta from actual completion

**Reproduce:** call `planner.record_progress` with `units: -1000` on a topic at zero completion. The call succeeds, completion stays zero, and a **-1000-unit** log is appended. A smaller correction also succeeds even when it exceeds the currently completed work. [Response](evidence/negative-progress-rejected.json) (the filename describes the intended rejection, which did not occur).

**Impact:** pace/history aggregate the raw log, while topic completion uses a clamped value. An agent correction can corrupt the student's pace and progress history.

**Cause:** [MCP progress mutation](../../../convex/mcpPlanner.ts) clamps completion but writes `args.units`; the browser progress mutation uses the same pattern.

**Acceptance:** reject invalid deltas or record the effective delta consistently, and explain the bound in the tool response. Test positive over-completion and negative corrections against history totals.

### F05 — P1: manual management cannot configure the study calendar

**Reproduce:** inspect New, More, Appearance, Account settings, Commands, course/topic/exam inspectors and Reflow. Capacity is exposed in Reflow, but study weekdays, blackout dates and timezone are not editable in the web UI. Existing preferences included a 16 October blackout, visible through MCP but not manageable by the student.

**Impact:** a student managing the plan themselves cannot mark holidays, change weekend availability or inspect the calendar constraints behind a generated plan. This fails the requested fully functional manual-management fallback.

**Acceptance:** expose the same calendar settings in the UI, show their scope across semesters, and include the active constraints in schedule previews. Different availability by weekday and recurring classes/practicals currently have no model representation; these are further product limitations.

### F06 — P2: atomic semester creation hits a hidden expansion limit

**Reproduce:** `planner.create` with seven courses, one exam per course, 13 topics per course, and initial generation. All advertised array sizes are valid, but it expands to **106 commands** and fails: “Complete plan expands beyond the 100-command transaction limit; split the plan.” [Response](evidence/big-plan.json)

**Impact:** ordinary semester outlines exceed the supposedly complete atomic creation workflow. Splitting introduces more calls, intermediate incomplete plans and recovery work. Seven courses plus 89 topics, matching the bundled MHH sample's scale, already exceeds the cap without dependencies or manual blocks.

**Acceptance:** advertise and preflight the effective limit with a command-count estimate and actionable batching guidance, or provide bounded staged creation/finalization suitable for full semesters. Do not simply remove transaction safety limits.

### F07 — P1: agent connection setup and revocation are not discoverable from the planner

**Reproduce:** search menus, Account settings and Commands for agent/MCP connections. There is no entry or setup URL. Direct navigation to `/connections` works and revocation is effective; the empty page says to use the “Study Planner MCP URL” without displaying it.

**Impact:** the app's expected primary workflow requires knowing routes from repository documentation. A student cannot readily connect an LLM or withdraw its access.

**Acceptance:** add a visible Connected agents entry, a copyable canonical `/mcp` URL and concise client setup guidance. Keep technical OAuth details out of the ordinary student flow.

### F08 — P1: humans cannot review or undo agent changes in the UI

**Reproduce:** agent changes produce audit history and eligible undo through MCP. No change-history or undo entry was found in planner menus, Commands or `/connections`; that page exposes client/scopes/timestamps/revocation only.

**Impact:** the person primarily viewing an LLM-managed plan cannot independently answer “what changed?” or reverse the last mistake. Browser progress also lacks a session/history editor for entering a previous day's progress, duration or note; MCP supports those fields.

**Acceptance:** offer a human-readable recent-changes view with actor, affected plan and concise changes, plus eligible undo. Expose dated study-session entry/correction without requiring an agent.

### F09 — P2: protected concurrent saves produce developer-facing recovery instructions

**Reproduce:** type a topic-name draft; apply an MCP note edit while the browser draft is unsaved; blur the name field. The stale save is correctly rejected and the agent's note survives. The alert includes `CONVEX M(planner:updateTopic)`, source paths and a stack trace, and tells the student to “Reload planner.get and rebase the command batch.” [Screenshot](evidence/conflict.png)

**Impact:** a safe failure becomes confusing. There is no clear retry/review action or save-state explanation for the retained draft. MCP validation failures also return stack traces rather than compact actionable errors.

**Acceptance:** preserve the draft, explain that the plan changed elsewhere, and provide review/retry/cancel actions. Keep technical conflict metadata available to agents in structured output without showing implementation traces to students.

### F10 — P2: manually created blocks cannot specify their workload in the UI

**Reproduce:** add a block in the topic inspector. It records dates and `source: manual`, but no `plannedUnits`; there is no workload field. Preview regeneration afterward: the full remaining topic workload is still generated in addition to the manual commitment. [Response](evidence/ui-manual-block-reflow.json), [inspector](evidence/desktop-inspector.png)

**Impact:** a manually booked reading/revision session reserves its entire day in capacity accounting, yet covers no material in remaining-work accounting. Students cannot express “20 slides in this session”; partial-day OSCE practice is also awkward.

**Acceptance:** allow workload or planned time per manual session, show its contribution, and make the no-size behavior explicit. Preserve manual dates during regeneration.

### F11 — P2: German material names can become the wrong units

**Reproduce:** paste `Niere — 2,5 hours` followed by `Anki — 100 Karten`. Preview warns that Karten is unknown but interprets the latter as **100 hours**, inherited from the preceding line. `Folien` is also unknown. Decimal commas themselves parse correctly. [Screenshot](evidence/german-bulk-input.png)

**Impact:** German source outlines need translation or careful repair. Inherited fallback can massively distort workload while the Add action remains available.

**Acceptance:** recognize common German unit aliases (Folien, Seiten, Karten, Stunden), or require explicit correction for unknown units. Show how fallback is chosen.

### F12 — P2: loading an existing outline and adding it duplicates every topic

**Reproduce:** create six topics; reopen Add topics → Paste a list → Load existing topics → Add 6 topics. The course now contains 12 topics, including all six names twice. Existing progress/scheduling is not attached to the new copies. [Stored result](evidence/manual-workflow.json)

**Impact:** “Load existing topics” looks like a way to edit the existing list, but it seeds an additive import. This can double the remaining workload after a minor outline change.

**Acceptance:** make the operation explicitly copy/additive, warn about existing matches, or implement a previewed update operation using stable references.

### F13 — P2: accepted MCP states disagree with scheduler/UI semantics

Three concrete contract inconsistencies were reproduced:

1. Capacity **zero** is accepted, but regeneration silently substitutes **40** via `capacity || FALLBACK_CAPACITY_UNITS`; zero produces blocks and no warning. [Response](evidence/zero-capacity.json)
2. `preferences.update` calls its input a `patch`, but changing only capacity fails because weekdays, blackouts, theme and accent are required. [Response](evidence/preferences-partial.json)
3. Setting a topic to `status: done` with zero completed units is accepted, then regeneration still schedules all 120 units. [Response](evidence/done-topic.json)

**Impact:** agents must infer undocumented semantics, and apparently successful commands may not implement the student's intent.

**Acceptance:** reject or honor zero explicitly; make patches genuinely partial; enforce or document a consistent completion/status model. Expose actionable errors in structured form.

### F14 — P2: a new feasible plan immediately presents every course as behind

**Reproduce:** generate the initial five-course schedule: warnings are empty and all material fits. Before any progress exists, all five courses appear in Attention needed and the Today page's Behind list; outline labels finish as unknown.

**Impact:** the first view conflates “no measured pace yet” with evidence of being behind. It undermines confidence in the newly designed semester and hides genuinely overdue work among unknown courses.

**Cause:** sustainable measured pace is zero when there is no study history, so `onTrack` is false even if configured capacity and the proposed schedule are sufficient.

**Acceptance:** distinguish planned feasibility, unknown observed pace and measured delay; show a short explanation of what evidence each status uses.

### F15 — P2: refresh/navigation loses the current semester and view

**Reproduce:** select the MHH test semester and Timeline/Outline; reload or return from `/connections`. The app returns to the first plan and Today.

**Impact:** someone checking a semester plan or visiting connection settings repeatedly has to reselect context. Direct links also cannot convey the current plan/view.

**Acceptance:** persist or encode the selected semester/view in the URL or per-account workspace state; recover safely if that plan disappears.

### F16 — P3: empty and untracked states give misleading guidance

**Reproduce:** create a new empty semester with no filters active. It says every course is hidden by focus/search and recommends widening filters instead of adding the first course. In the manual scenario, Auto-plan says “Everything fits” while the unsized topic is entirely omitted from generated blocks.

**Impact:** onboarding points at an irrelevant fix, and a partial workload estimate reads as complete reassurance.

**Acceptance:** separate empty-semester, filtered-empty and unsized-work states. Provide a first-course action and state how many unsized topics were excluded from feasibility.

## GitHub follow-up issues

Created and verified on 4 October 2026. All 16 carry the shared [`usability-test`](https://github.com/erikbaender/study-planner/labels/usability-test) label. Each issue includes the reproduction, impact, acceptance criteria and desktop/MCP test context. Priorities follow the audit severity definitions; product limitations use enhancement labels. Existing issues were checked before creation.

| Finding | Priority | Issue |
| --- | --- | --- |
| F01 | P1 | [#70 — Represent mixed study materials with a common time budget](https://github.com/erikbaender/study-planner/issues/70) |
| F02 | P1 | [#71 — Enforce prerequisite completion dates during schedule generation](https://github.com/erikbaender/study-planner/issues/71) |
| F03 | P1 | [#72 — Report manual study sessions after the exam as a preparation shortfall](https://github.com/erikbaender/study-planner/issues/72) |
| F04 | P1 | [#73 — Keep progress-log deltas consistent with bounded topic completion](https://github.com/erikbaender/study-planner/issues/73) |
| F05 | P1 | [#74 — Expose study weekdays, blackout dates and timezone in the web UI](https://github.com/erikbaender/study-planner/issues/74) |
| F06 | P2 | [#75 — Make full-semester MCP creation limits explicit and workable](https://github.com/erikbaender/study-planner/issues/75) |
| F07 | P1 | [#76 — Make MCP setup and Connected agents discoverable from the planner](https://github.com/erikbaender/study-planner/issues/76) |
| F08 | P1 | [#77 — Expose agent change history, undo and dated study logs in the web UI](https://github.com/erikbaender/study-planner/issues/77) |
| F09 | P2 | [#78 — Provide usable recovery for concurrent browser and MCP edits](https://github.com/erikbaender/study-planner/issues/78) |
| F10 | P2 | [#79 — Allow planned workload on manually created study blocks](https://github.com/erikbaender/study-planner/issues/79) |
| F11 | P2 | [#80 — Prevent German bulk-import units from inheriting incorrect workload units](https://github.com/erikbaender/study-planner/issues/80) |
| F12 | P2 | [#81 — Prevent Load existing topics from silently duplicating the outline](https://github.com/erikbaender/study-planner/issues/81) |
| F13 | P2 | [#82 — Align MCP capacity, preference-patch and completion-state semantics](https://github.com/erikbaender/study-planner/issues/82) |
| F14 | P2 | [#83 — Distinguish unknown study pace from being behind schedule](https://github.com/erikbaender/study-planner/issues/83) |
| F15 | P2 | [#84 — Preserve the selected semester and view across reload and navigation](https://github.com/erikbaender/study-planner/issues/84) |
| F16 | P3 | [#85 — Show accurate empty-plan and unsized-work guidance](https://github.com/erikbaender/study-planner/issues/85) |

## What worked well

The hierarchical data model, local references, German topic names, provisional exam windows and preview/apply separation suit LLM plan design. Idempotency, stale-revision protection, actual server-side validation, audit pagination and latest-transaction undo worked in live calls. Browser changes propagated to MCP and agent changes appeared in the browser. Moving an auto block made it manual; manual commitments were preserved in regeneration previews. Low-capacity and no-study-day previews reported explicit shortfalls instead of pretending everything fit.

Bulk topic preview, fractional quantities and decimal commas reduce manual entry work. The outline and inspector make small desktop edits possible without a separate edit page. Export/import preserved course content, workloads, blocks and study history with fresh IDs; malformed JSON produced a plain-language error. Revocation immediately rejected both read and write attempts and subsequent refresh.

## Recommended order of work

1. Make schedule feasibility trustworthy: F01–F04, then manual session workload F10.
2. Make LLM ownership observable and recoverable: calendar controls F05, agent setup F07, history/undo F08 and conflict UX F09.
3. Make semester-scale agent creation and the tool contract predictable: F06 and F13.
4. Improve the German/manual workflow and status communication: F11, F12, F14–F16.

## Limits of this result

This is a bounded usability audit, not an exhaustive QA/security/accessibility certification. No source fixes, broad refactor, new automated test suite or deployment was attempted. Real Codex/ChatGPT/Claude connector installation, two-account isolation, browser restart, expired/replayed OTPs, provider failures, offline behavior, load testing, screen-reader use and detailed animation recordings remain untested. Desktop browser tasks and HTTP MCP results are distinguished above. Fresh OAuth consent was completed only after the requested account was restored; no grant was issued to the automatically selected alternate saved account.

## Handoff and cleanup

OpenAI usage was checked periodically at 11:21, 11:26, 11:32, 11:38, 11:47 and 11:50 UTC: weekly remaining **88%, 87%, 86%, 85%, 85%, 84%**; reset reported as 9 October 2026 at 23:11 +02:00. Session status was `temporarily_removed` with no numeric limit; no session allowance was guessed. Work used one agent and actual MCP calls, not extra LLM requests.

Both temporary grants are revoked. All three `[USABILITY TEST]` semesters were removed through the UI after verifying each deletion dialog. MCP confirmed that only the original semester remains, with four courses, 12 topics, unchanged exam deadlines, unchanged account preferences and zero remaining study-log entries. Applying the UI schedule with unchanged global preferences advanced the original plan's revision from 3 to 4; original coursework was not a mutation target. The baseline comparison covers counts, deadlines and preferences, not a byte-for-byte comparison of all original fields. [Cleanup verification](evidence/cleanup.json)

Fresh sign-out automatically selected another saved account. No planning or MCP test was conducted under that identity. The requested email arrived; the user completed the email-code dialog, and the toolbar then confirmed `erikbaender8549@gmail.com`. Read-only consent and testing followed under that account. No code, token or authentication message body is stored in this report/evidence. Temporary local authentication credentials and test scripts were removed after final revocation.

The preview is left signed in to the requested account with the original semester selected. The shared development service remains running from this worktree; final ownership and HTTP health checks confirmed an active service, the matching working directory and HTTP 200 at `http://localhost:3000`. The only repository additions are this report and its evidence. No fixes were applied; the recommended implementation order above is the defined next step.
