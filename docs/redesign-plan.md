# Study Planner — Architecture Repair & UX Redesign Plan

Status: **approved, phase 0 complete**
Supersedes and replaces: `REQUIREMENTS.md` (deleted in this PR; preserved in git history at `7e6152e`)

---

## 1. Why this plan exists

A static and dynamic audit of the app (`main` @ `7e6152e`) found a sound backend, a
compromised frontend, and a broken primary user journey. The conclusion was **repair, don't
rewrite** — but the frontend is worth throwing away, and the product model itself is wrong for
the person it is meant to serve.

This plan does three things:

1. **Fixes the regressions** that make the app unusable today.
2. **Fixes the architecture** that makes every future feature cost double.
3. **Replaces the product and interface design** with one built around a real user.

### Audit summary

What is genuinely good and will be kept:

- `convex/planner.ts` — ownership checks on every mutation via a proper
  `assertRangeOwner → assertTopicOwner → assertCourseOwner → assertPlanOwner` chain. No IDOR
  gaps. Cascade deletes, dangling-dependency cleanup, dependency cycle detection, date
  validation.
- Convex schema with correct indexes (`by_owner`, `by_plan`, `by_course`, `by_topic`).
- Build hygiene: `typecheck`, `lint`, and `build` all pass clean; console is silent.
- The Gantt date math is correct (verified by drag test: `05-18→05-25` moved exactly 5 days).

What is broken:

| # | Problem | Evidence |
|---|---------|----------|
| 1 | **Cannot create a course.** A new plan is a permanent dead end — no course, so no topics, milestones or ranges. | On a new plan the only interactive element on the page is the plan picker. |
| 2 | GitHub import unreachable | `setModalMode("github")` has zero call sites; `convex/github.ts` (309 lines) is dead. |
| 3 | JSON import/export unreachable | `serializePlans` / `parsePlannerJson` have zero callers, despite being an explicit requirement. |
| 4 | Light mode unreachable | `const [theme] = useState(...)` — setter dropped; 876 lines of CSS maintain a theme that can never render. |
| 5 | Every drag opens a modal | `GanttBar` wires `onPointerDown` and `onClick` with no movement threshold. |
| 6 | Detail popup shows wrong counts | Metrics block renders whenever a *course* resolves, so topic popups show parent-course totals. |
| 7 | Dual-write architecture | ~20 mutations each implemented twice (Convex + local `useState`), plus a translation layer between two parallel type systems. Validation exists only server-side, so the two paths have already diverged. |
| 8 | No virtualization, no zoom, no today marker | One 42px DOM column per day. Sample plan is already 3,286px wide; the real 89-issue dataset would be ~15,000px. |
| 9 | Zero tests | No test framework in the repo at all. |

Issues 1–4 all trace to a single commit series — the navigation overhaul deleted the left nav
and inspector panels, which held course creation, import/export and the theme toggle, and only
re-added plan and topic creation. **These are regressions, not foundational flaws.**

---

## 2. The deeper problem: the app models time, but not work

This is the reason a redesign is warranted rather than a repair.

The current model is `Plan → Course → Topic → DateRange`. To use it, you hand-draw a bar on a
calendar for every unit of study. For a user with **10 courses × dozens of topics**, that is
several hundred bars drawn by hand, and redrawing all of them every time she falls behind.

A student does not think *"this topic occupies May 18–25."* She thinks *"I have 1,240 slides of
Biochemistry and 38 days until the exam."* **Volume is the unit of planning, and the current
data model has no concept of it.** There is no notion of how much material a topic contains, how
much is done, or whether the plan is achievable.

Everything in this redesign follows from adding that one missing concept.

---

## 3. Guiding persona

> **Lena, 25, medical student.**
>
> She is taking **~10 courses**, each with **dozens of topics**. Across them sit **thousands of
> slides and PDF pages** that have to be worked through systematically. Exams cluster at the end
> of term; some dates are confirmed, others are still a provisional window ("exam period 12–20
> July"). She studies most days, with variable capacity. She falls behind regularly and needs to
> recover without re-planning everything by hand.

The four questions the app must answer, in priority order:

1. **"What do I study today?"**
2. **"Am I on track for the Biochemistry exam?"**
3. **"I have 1,200 slides left and 40 days — how many per day?"**
4. **"I lost a week. Fix my plan."**

The current app answers none of them. Design decisions below are justified against this list.

---

## 4. Product principles

1. **Say what you have to learn and when the exam is; the app works out when to study it.**
   Scheduling is *output*, not input. This inverts the current model.
2. **Bulk in, detail optional.** Entering 400 topics must take minutes. Sections, dependencies,
   priorities and notes are progressive disclosure.
3. **Progress is first-class.** Every topic has a size and a completion count. Every view can
   show a fill level.
4. **Falling behind is normal.** Recovery is a first-class action ("Reflow"), not a manual redraw.
5. **Never lie about certainty.** Provisional exam dates look visibly different from confirmed ones.
6. **Keyboard-first, macOS-native feel.** See §7.

---

## 5. Domain model

### 5.1 The "simple and intuitive system" for courses and topics

Deliberately three levels, with one optional grouping that costs nothing when unused:

- **Course** = a subject with an exam. Has a colour, one or more exams, and topics.
- **Topic** = a chunk of material *with a size*. Name + "how much" is all that is required.
- **Section** = an optional free-text label on a topic (`"Block 1"`, `"Lecture 1–6"`). Purely a
  display grouping — it is a string on the topic, **not** a hierarchy level. Courses that don't
  need it stay flat.
- **Study block** = a scheduled piece of work. Normally *generated*, then nudged by hand.

This keeps the mental model at "courses contain topics" while still supporting the ~40-topic
courses Lena has.

### 5.2 Schema

```ts
plans          // exposed in the UI as "Semester"
  ownerId, name, startDate, endDate, notes

courses
  planId, name, code?, color, notes, order

exams          // replaces `milestones`
  courseId, name
  kind:   "exam" | "deadline" | "presentation" | "other"
  startDate, endDate?          // endDate present ⇒ a provisional window
  status: "confirmed" | "provisional"
  notes, order

topics
  courseId, name
  section?:  string            // optional display grouping
  unit:      "slides" | "pages" | "cards" | "videos" | "hours" | "items"
  totalUnits, completedUnits   // totalUnits = 0 ⇒ size untracked
  status:    "planned" | "active" | "done"
  priority:  "low" | "normal" | "high"
  dependencyIds: Id<"topics">[]
  color?, notes, order

studyBlocks    // replaces `topicRanges`
  topicId, startDate, endDate
  plannedUnits?: number
  source: "manual" | "auto"    // reflow may replace "auto", never "manual"
  
studyLog       // progress events — enables velocity and streaks
  topicId, date, units, minutes?, note?

preferences
  ownerId, dailyCapacityUnits?, studyDaysOfWeek[], blackoutDates[],
  theme: "system" | "light" | "dark", accentColor
```

Two fields carry disproportionate weight:

- **`source: "manual" | "auto"`** — without it, "Reflow" would destroy hand-placed work. With it,
  rescheduling is safe and repeatable.
- **`studyLog`** — turns progress from a number into a *rate*, which is what makes
  "at your current pace you finish 3 days late" possible.

### 5.3 Derived metrics (pure functions, heavily tested)

```
courseProgress   = Σ completedUnits / Σ totalUnits
remainingUnits   = Σ (totalUnits − completedUnits)
studyDaysLeft    = study days between today and exam, minus blackout dates
requiredPace     = remainingUnits / studyDaysLeft
actualVelocity   = trailing 7-day mean from studyLog
onTrack          = requiredPace ≤ min(dailyCapacity, actualVelocity)
projectedFinish  = today + remainingUnits / actualVelocity
```

`projectedFinish` vs. exam date is the single most useful number in the app.

### 5.4 Bulk entry format

One textarea, paste-friendly. Indented lines are topics, unindented lines are sections:

```
Block 1
  Cell biology — 120 slides
  Membrane transport — 85 slides
Block 2
  Glycolysis — 140 slides
  Citric acid cycle — 95 pages
```

Parser: `name — <number> <unit>`, with unit inherited from the previous line when omitted. This
is how 400 topics get entered in one sitting, and it is the feature most directly aimed at the
persona.

---

## 6. Scheduling engine

A pure, deterministic module (`src/domain/scheduling.ts`) — no React, no network, fully unit-tested.

**Inputs:** topics (size, remaining, priority, dependencies), exam dates, daily capacity,
study days of week, blackout dates, existing `manual` blocks.

**Output:** a set of `auto` study blocks.

**Algorithm:** schedule backwards from each exam date. Reserve capacity for higher-priority and
dependency-blocked topics first, respect topological order of `dependencyIds`, spread each
topic's remaining units across available study days without exceeding daily capacity, and never
move or overwrite a `manual` block.

**Operations exposed in the UI:**

- `Auto-plan course` — fill an empty or partially planned course backwards from its exam.
- `Reflow from today` — recompute future `auto` blocks after falling behind. Past blocks are
  left untouched as a historical record.
- `What-if capacity` — preview the schedule at a different units/day before committing.

**Failure is an output, not an exception.** If the work does not fit before the exam, the engine
returns an explicit infeasibility with the shortfall, and the UI says so plainly:
*"Biochemistry needs 62 slides/day to finish in time; your capacity is 40. You are 780 slides
over."* Silently producing an impossible plan would be the worst outcome for this persona.

---

## 7. Interface design

### 7.1 Direction

Modern macOS (macOS 26 "Tahoe" lineage) — a **document-workspace** app in the vein of Mail,
Notes, Reminders and Xcode, not a dashboard.

**On Liquid Glass:** adopted for *chrome only* — sidebar, toolbar, inspector, sheets, popovers.
The timeline canvas stays opaque. Applying `backdrop-filter` to a scrolling surface with
hundreds of bars would wreck scroll performance, which matters more than the effect. Respect
`prefers-reduced-transparency` by falling back to solid materials.

**On typography:** Apple's SF Pro cannot be licensed for general web use. Use the system stack —
`-apple-system, "SF Pro Text", "Inter Variable", system-ui, sans-serif` — which resolves to real
SF on Apple hardware and Inter elsewhere. Base size 13px, macOS-like scale.

### 7.2 Layout — three-column split view

The canonical macOS `NavigationSplitView`:

```
┌───────────────┬──────────────────────────────────┬──────────────┐
│  SIDEBAR      │  CONTENT                         │  INSPECTOR   │
│  (source list)│  (Today / Timeline / Outline)    │  (contextual)│
│               │                                  │              │
│  Today        │  ┌────────────────────────────┐  │  Topic       │
│  Upcoming     │  │                            │  │  ─────────   │
│  Behind (3)   │  │      view canvas           │  │  Size        │
│               │  │                            │  │  Progress    │
│  COURSES      │  │                            │  │  Dependencies│
│  ● Biochem  ▓▓│  │                            │  │  Blocks      │
│  ● Physio   ▓ │  │                            │  │  Notes       │
│  ● Anatomy  ▓▓│  └────────────────────────────┘  │              │
└───────────────┴──────────────────────────────────┴──────────────┘
```

- **Sidebar** — smart views (Today, Upcoming, Behind) above a course source list. Each course
  shows a colour dot, a progress bar, and an exam countdown badge (`14d`). Provisional exams
  show the badge outlined rather than filled.
- **Content** — one of three views, switched by a toolbar segmented control.
- **Inspector** — toggleable right panel (⌥⌘I) showing details for the current selection.
  Replaces the modal-per-click pattern entirely.

**Toolbar:** unified, translucent. View switcher (segmented), zoom control, `Today` button,
search field, and a `+` menu.

### 7.3 Views

**① Today — the default landing view.** Answers question 1.

- Today's blocks as a checklist, each with an inline stepper to log units done.
- A "next up" card with the current topic and its target for today.
- Next three exams with countdown and an on-track indicator.
- A recovery banner when behind: *"Biochemistry is 210 slides behind — [Reflow]"*.

**② Timeline — the rebuilt Gantt.** Answers questions 2 and 4.

- Zoom levels: **Day / Week / Month / Quarter** (segmented control). Fixes the 15,000px problem.
- **Virtualized** on both axes (TanStack Virtual) — target 60fps at 400 topics.
- A **today line** (the app currently has no today marker at all).
- **Exam markers** as vertical rules with a flag chip; provisional exams render as a hatched
  band spanning the window rather than a hard line.
- Course swimlanes, collapsible, with an aggregate roll-up bar.
- **Bars show progress as an internal fill** — a half-done topic reads as half-full.
- Drag with a **4px threshold** so dragging no longer fires a click; snap to the zoom unit;
  shift-click multi-select and group drag.
- Click a bar → **popover** anchored to the bar, not a full-screen modal.
- Dependency arrows as curves, toggleable.

**③ Outline — the setup workhorse.** Answers question 3, and is where the 400 topics get entered.

- Editable outline/table: Course → Section → Topic.
- Columns: Name, Unit, Total, Done, Progress, Status, Exam.
- Inline editing, Tab to next cell, ⌘⏎ for a new row, drag to reorder.
- **Bulk paste** using the §5.4 format.

### 7.4 macOS idioms to adopt

- Sheets for multi-field create/edit; **popovers** for quick edits; **context menus** on right-click.
- Segmented controls rather than tabs. Source-list sidebar with disclosure triangles.
- **⌘K command palette** — jump to any course/topic, run any action.
- Shortcuts: ⌘N new, ⌘F find, ⌘1/2/3 switch view, ⌥⌘I inspector, ⌘⌫ delete, Space quick-look.
- Concentric corner radii, macOS focus rings (3px accent @ 40% + 1px inner), user-selectable
  accent colour.
- Light/dark following `prefers-color-scheme` with a manual override that actually works.

### 7.5 Accessibility

Non-negotiable, and currently absent — Gantt bars are plain `div`s that cannot be focused or
reached by keyboard.

- Timeline exposed as an ARIA grid; every bar focusable, with arrow-key move and resize.
- Full keyboard reachability for all actions; visible focus throughout.
- `prefers-reduced-motion` and `prefers-reduced-transparency` honoured.
- WCAG AA contrast in both themes — verified, not assumed. The Apple palette's yellow and mint
  fail AA on white for small text and need adjusted text-on-colour pairings.
- Screen-reader labels carrying topic, dates, and progress.

### 7.6 Mobile

Desktop-first, but Lena will check her phone. Below `md`: single column, bottom tab bar
(Today / Timeline / Courses / More) — an iOS idiom, appropriate on a phone. The timeline
defaults to a **vertical agenda list** rather than a horizontally-scrolling Gantt, which is
unusable at 390px (currently ~4 days are visible). Horizontal Gantt remains available via a
toggle with pinch-zoom.

---

## 8. Technical architecture

### 8.1 Kill the dual-write

One interface, two implementations, no branching in the UI:

```
src/domain/            pure types + logic (scheduling, metrics, parsing) — no React, no network
src/data/
  repository.ts        PlannerRepository interface
  convex-repository.ts Convex-backed
  local-repository.ts  IndexedDB-backed (survives refresh; the current local mode does not)
src/features/          today/ timeline/ outline/ inspector/ command-palette/
src/ui/                macOS design-system primitives
```

Validation moves into `src/domain` so **both** backends enforce the same rules. Convex keeps its
server-side checks as the security boundary — client validation is for UX, server validation is
for trust.

### 8.2 Stack changes

| Change | Rationale |
|---|---|
| **Remove Ionic + ionicons** | Used for exactly one `IonModal`, reaching into `shadowRoot` internals. It is an iOS-mobile framework being used to build a macOS-like desktop app. ⚠️ *Deviates from the original brief — see §11.* |
| **Add Radix UI primitives** | Unstyled, accessibility-correct popovers/menus/dialogs/tooltips, with a bespoke macOS skin on top. shadcn/ui was considered but its visual defaults would be fought at every step. |
| **Add TanStack Virtual** | Timeline virtualization. |
| **Add Zustand** | Ephemeral view state (zoom, selection, collapsed lanes). Server state stays in Convex reactive queries. |
| **Keep** | Next.js 16, React 19, Tailwind v4, Convex, Convex Auth, date-fns, zod, clsx, lucide-react. |

### 8.3 Testing

Currently zero. Target:

- **Vitest** — `src/domain` at high coverage. The scheduling engine and metrics are pure
  functions with sharp edge cases (DST, month boundaries, zero-capacity, infeasible plans,
  dependency cycles); this is where bugs will hide.
- **Testing Library** — component behaviour.
- **Playwright** — the journeys that broke this time: create semester → course → topics →
  exam → auto-plan → log progress → reflow. Plus a guard asserting **every domain entity is
  creatable from a cold start**, so issue #1 can never recur silently.
- CI runs `lint`, `typecheck`, `test`, `build` on every PR.

### 8.4 Schema replacement and seed data

**No migration.** Existing data is explicitly disposable, so `schema.ts` is simply replaced and
the dev deployment reseeded. This removes the single riskiest item in the plan.

In its place, a **seed script** (`convex/seed.ts` + a local-repository equivalent) generates a
realistic development dataset modelled on the persona: 10 courses, 30–45 topics each,
mixed units (slides / pages / videos), partial completion, a spread of confirmed and
provisional exam dates, and a few dependency chains. ~400 topics total, which doubles as the
performance fixture for phase 9 and the fixture set for tests.

Sample data being generated rather than imported also means the timeline's worst case is
exercised from phase 5 onward, instead of being discovered late.

### 8.5 GitHub import: removed

`convex/github.ts` (309 lines), the GitHub helpers in `src/lib/import-export.ts`, and the dead
`setModalMode("github")` path are deleted in phase 1. The feature was already unreachable, its
only purpose was seeding real data, and the seed script replaces that purpose. This also drops
the `GITHUB_IMPORT_TOKEN` / `GITHUB_PROJECTS_TOKEN` surface entirely.

JSON import/export is **kept** and restored to the UI — it is the actual portability story.

---

## 9. Delivery plan

Each phase is a reviewable PR. Phases 1–3 are foundation; the app stays on the old UI until
phase 5 lands, so `main` is never broken.

| Phase | Scope | Est. |
|---|---|---|
| **0** | *(this PR)* Plan; remove `AGENTS.md` and `REQUIREMENTS.md` | — |
| **1** | Domain layer, repository abstraction, new schema, seed script, delete GitHub import, Vitest + CI | 2–3 d |
| **2** | macOS design system: tokens, materials, typography, primitives on Radix; remove Ionic | 2 d |
| **3** | App shell: three-column split view, toolbar, sidebar, inspector, ⌘K, keyboard map | 2 d |
| **4** | Outline view + bulk entry parser — *unblocks course creation, fixing audit issue #1* | 2 d |
| **5** | Timeline rebuild: virtualization, zoom, today line, exam markers, drag threshold, popovers | 3–4 d |
| **6** | Scheduling engine + Today view + Reflow | 3 d |
| **7** | Exams, progress logging, velocity, on-track indicators | 2 d |
| **8** | Restore JSON import/export into the new UI | 1 d |
| **9** | Accessibility audit, mobile layout, performance pass at 400 topics, light/dark polish | 2–3 d |

**≈ 3 weeks.** Phase 4 is deliberately early: it is the smallest change that makes the app
usable again.

### Traceability to the original audit recommendations

| Audit recommendation | Where it lands |
|---|---|
| Restore course creation, import/export, theme toggle | Phases 4, 8, 2 |
| ~~Restore GitHub import~~ | Dropped — feature removed (§8.5) |
| Add drag threshold | Phase 5 |
| Collapse dual-write architecture | Phase 1 |
| Split the 1,910-line component | Phases 2–6 (feature-sliced by construction) |
| Add tests | Phase 1, then every phase |
| Virtualization, zoom, today marker | Phase 5 |
| **NEW — full UI/UX redesign** | Phases 2–7 |

---

## 10. Removed in this PR

- **`AGENTS.md`** — deleted as requested.
- **`REQUIREMENTS.md`** — deleted as requested. It was the original product brief; this document
  replaces it. Recoverable from git history at `7e6152e`.
- No Copilot instructions file (`.github/copilot-instructions.md`) exists; nothing to remove.
- `CLAUDE.md` was already removed in `296f2d3`; it only ever contained a one-line `@AGENTS.md`
  pointer generated by the Next.js scaffolding.

⚠️ **One thing worth preserving from `AGENTS.md`.** It carried a genuine technical warning:

> *"This is NOT the Next.js you know. This version has breaking changes — read the relevant
> guide in `node_modules/next/dist/docs/` before writing any code."*

That is true and load-bearing — Next.js 16 differs from most training data. It is captured here
in §12 rather than in an instructions file.

---

## 11. Decisions — signed off

All four confirmed by the repository owner on 2026-07-29.

1. ✅ **Ionic and ionicons are removed.** A deliberate deviation from the original brief
   ("Use ... Ionic for the frontend"): it is used for one modal, and it is an iOS-mobile toolkit
   in a macOS-desktop app. Removed in phase 2.
2. ✅ **Today is the landing view, not the Gantt.** The Timeline remains a core view and gets the
   most engineering effort, but it is a poor answer to *"what do I study today?"*.
3. ✅ **`REQUIREMENTS.md` is deleted** (phase 0, this PR). It is preserved in git history at
   `7e6152e` if it is ever needed.
4. ✅ **Units are per-topic, not global.** Lena can mix slides, pages and videos across topics.
   Costs a little UI complexity; avoids forcing a fake common unit.

---

## 12. Notes for implementers

- **Next.js 16 is not the Next.js in your training data.** Read `node_modules/next/dist/docs/`
  before writing framework code, and heed deprecation notices.
- Convex server-side checks are the security boundary. Client-side validation is a UX
  affordance and must never be the only enforcement.
- The scheduling engine must stay pure and free of `Date.now()` — inject the current date, so it
  is testable. The old code hard-coded `const today = "2026-05-01"`, the date it was written.
- Never let "Reflow" touch a `manual` block.

## 13. Environment and access needed

**Nothing.** The whole plan is buildable from the repo as it stands.

Dropping the migration (§8.4) removed the one item that genuinely wanted a live deployment.
What remains is a pure refactor plus new code: extract a `PlannerRepository` interface, move the
existing Convex calls behind `convex-repository.ts`, write `local-repository.ts` against
IndexedDB, and seed both from the same generator. All of it is validated by `typecheck`, `lint`,
Vitest, Testing Library and Playwright against the local repository — none of which touch a
deployment.

Two things stay unverified-by-execution and should be flagged as such at review time:

- **Convex accepts the new `schema.ts`.** Its validators are checked at push time, not compile
  time. The risk is low (the schema uses only ordinary `v.*` types) and the failure mode is
  loud and immediate when you first run `pnpm convex:dev`.
- **Signed-in flows end to end.** These need `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` in the
  deployment env. The repository interface makes the auth boundary narrow, and E2E tests run
  against the local repository instead.

If either becomes a problem, the smallest sufficient grant is a **dev deployment for this
project** — `pnpm convex:dev` once, then share the generated `.env.local` (`CONVEX_DEPLOYMENT`,
`NEXT_PUBLIC_CONVEX_URL`). That is a project-scoped dev key, revocable by deleting the
deployment, not account access. It is not needed to start.

## 14. Out of scope

Spaced repetition / flashcard scheduling; PDF or slide-deck ingestion; collaboration and
sharing; native mobile apps; calendar (ICS) sync; offline-first sync conflict resolution.
Several are natural follow-ons once the domain model above exists.
