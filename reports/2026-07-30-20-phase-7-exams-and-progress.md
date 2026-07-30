# Phase 7 — Exams and progress

## Outcome

Phase 7 makes the evidence behind the schedule visible and editable:

- Outline has complete exam and deadline management;
- topic inspection has recent study history and a detailed progress-log sheet;
- Today and the course inspector expose observed velocity, required pace, and projected finish;
- all progress changes still cross the atomic `logStudy` repository boundary;
- all pace and on-track displays still consume `assessCourse`;
- the Phase 6 scheduling engine and persistence schema are unchanged.

This work continues draft PR #20 from the pushed Phase 6 head `bdb7706`.

## Exam workflow

`ExamManager` replaces the interim add/delete row in Outline. Each course now presents its exams
and deadlines in date order with type, certainty, date or window, notes, and named edit/delete
actions. The create/edit sheet covers every existing domain field:

- name;
- exam, deadline, presentation, or other;
- confirmed or provisional certainty;
- a fixed date or optional provisional end date;
- notes.

Switching an edited item from provisional to confirmed removes the old end date before the
repository write. A backwards window is rejected in the sheet and remains rejected independently
by both repository implementations. Provisional styling and wording remain present in the list,
editor, timeline, sidebar, and inspector.

## Progress history

A selected topic's inspector shows up to eight recent log entries scoped to that topic. Entries
show only the stored date, signed unit delta, optional duration, and optional note. The new logging
sheet accepts those same fields and sends one `StudyLogInput` to `logStudy`.

The existing Outline status control, Outline and Inspector sliders, and Today checklist continue
to express progress as deltas through the same mutation. There is no direct completion write in a
view. Consequently one repository transaction:

1. appends the study-log evidence;
2. clamps the topic's visible completion where appropriate;
3. derives planned, active, or done status;
4. feeds the next velocity and projection calculation.

## Pace and projection

`CoursePaceBadge`, `CoursePaceDetails`, and `describeCoursePace` are presentation helpers over
`CourseHealth`; they contain no second formula. Their numbers come from `assessCourse`, whose
velocity window, study-day calendar, provisional deadline behavior, and projected finish remain
in `src/domain/metrics.ts`.

Today's next-three-exam rows now state:

- observed units per study day, or that there is no recent pace;
- required units per study day;
- projected finish, or that it cannot yet be predicted;
- a shared on-track, behind, or lateness badge.

The course inspector expands the same assessment with remaining study days. Courses without an
upcoming exam still say so. Courses with an exam but no measured topic sizes now say “Needs topic
sizes”; zero measured work is no longer mistaken for completed work.

## Browser verification

The seeded 344-topic workspace was inspected in the collaborative browser:

- Today rendered pace and finish detail for all three nearby exams;
- the selected course inspector rendered observed pace, needed pace, projected finish, and study
  days left;
- the exam sheet opened with the existing course scrolled deep inside Outline while remaining
  fixed and fully bounded;
- the root and body matched the viewport at 1688×953, 1280×800, and 1024×768 with no horizontal
  or document-level vertical overflow;
- the narrow Outline table kept its legitimate horizontal scroll inside its own container;
- both exam and progress sheets remained fully inside the viewport;
- a fresh tab reported only the development HMR connection and no Next.js framework or
  application error.

The Chromium journey independently creates a provisional deadline with kind, window, and notes,
confirms it while clearing the window, deletes it, and records a topic progress event with units,
duration, and a note. It then continues through the previous large-outline and virtualized
timeline checks.

## Verification

Final validation on 2026-07-30:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test` — 23 files, 275 tests
- `pnpm test:e2e` — Chromium, 1 passed
- `pnpm build`

## Handoff

Phase 8 should preserve `PlannerExport` as the only interchange format and build an explicit
import/export sheet over the existing `importPlans` and `replaceAll` repository methods. Make
append versus destructive replacement intentional, preview document counts, surface validation
errors in the sheet, and prove a local JSON round trip in Chromium. Do not include authentication
or browser state in exported data.
