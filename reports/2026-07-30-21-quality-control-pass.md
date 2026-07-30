# Cross-phase quality-control pass

Date: 2026-07-30

Branch: `redesign/planner-ux-overhaul`

Audited tip: `e5044b7`

Scope: delivered redesign Phases 0–7

## Outcome

The existing automated suite was green, but an adversarial repository and browser pass found
several correctness and interaction defects outside its happy path. The confirmed desktop
regressions were fixed and covered. Phone-width usability remains intentionally open for Phase 9.

## Confirmed defects and resolutions

| Severity | Defect | Resolution |
| --- | --- | --- |
| High | JSON history and dependencies used course/topic names as identity. Repeated topic names in the standard sample caused silent cross-linking after replace or round trip. | Version-2 documents now add unique export-local topic refs for dependencies and history while retaining readable names for early-v2 compatibility. Ambiguous legacy paths are skipped rather than assigned to the wrong topic. |
| High | Append import added plans but silently discarded their study history. | Both local and Convex repositories now append referenced history with the imported plans. |
| High | Sample replacement preserved the previous scheduling preferences and could destroy existing data on one toolbar click. | Preferences now travel in exports and replacement restores them. Existing data puts sample replacement behind an explicit destructive confirmation. |
| Medium | Mutable React keys remounted Outline cells and Timeline blocks after repository updates, dropping focus during Tab and repeated arrow-key workflows. | Components now keep stable entity keys and reconcile draft values without replacing their DOM nodes. |
| Medium | The sidebar action labelled “New course” defaulted to a Topic form whenever a course was already selected. | Course-specific entry points now pass an explicit initial item kind. |
| Medium | Space on a focused button was intercepted by the global inspector shortcut, replacing native keyboard activation. | The shortcut now yields to native activation targets. The Chromium journey covers Space activation. |
| Medium | “Upcoming” counted 14 days in the sidebar but listed 30 days in the view. “Today” counted blocks while the destination grouped topics. | Both counts now share the destination view's horizon and grouping. |
| Medium | Exam deletion was immediate even though course/topic deletion was confirmed. | Exam and deadline deletion now uses a destructive confirmation sheet. |
| Low | A one-day late projection rendered “1 days late.” | Pace badges now inflect the singular correctly. |

## Browser evidence

- At 1280×800, the root document remained exactly viewport-sized; view scrolling stayed inside
  the workspace.
- A native Space press on the focused Upcoming sidebar row opened Upcoming rather than toggling
  the inspector.
- Repository-backed Outline updates retained cell focus and continued Tab order.
- Sample replacement and exam deletion both required confirmation.
- A fresh console contained only the development HMR connection and no application/framework
  errors during the exercised paths.

At 390×844, the root itself remained clipped to the viewport, but that hid the real failure:
fixed 256px navigation and 288px inspector columns collapsed the content, while toolbar controls
were positioned beyond the visible edge. The application is therefore not phone-usable yet.
Responsive navigation, inspector presentation, and compact toolbar design remain Phase 9 work.

## Validation

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — 24 files, 282 tests
- `pnpm test:e2e` — 1 Chromium journey
- `pnpm build`

The focused suite adds coverage for repeated-name portability, appended history, restored
preferences, stable editor focus, course-specific creation, sample confirmation, native Space
activation, and confirmed exam deletion.

## Remaining uncertainty and planned work

- Phase 8 still owns the explicit import/export sheet, preview, append-versus-replace choice,
  inline validation feedback, and browser round-trip workflow.
- Phase 9 still owns mobile layout, the formal accessibility audit, the 400-topic performance
  pass, and final light/dark polish.
- Signed-in Convex/auth behavior remains unverified end to end in this environment. The local
  repository and generated Convex types compile, but a live authenticated deployment is still
  required to execute that path.
