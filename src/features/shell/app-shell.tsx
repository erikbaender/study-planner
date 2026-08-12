"use client";

/**
 * The three-column split view.
 *
 * ```
 * ┌───────────────┬──────────────────────────────┬──────────────┐
 * │  sidebar      │  content                     │  inspector   │
 * │  focus +      │  Today / Timeline / Outline  │  contextual  │
 * │  course list  │                              │  (⌘I)        │
 * └───────────────┴──────────────────────────────┴──────────────┘
 * ```
 *
 * This file's whole job is wiring: it reads the repository, derives what the
 * three columns need, and hands the pieces down. Everything with an opinion in
 * it lives elsewhere — the scoping rules in `workspace/scope.ts`, the shortcuts
 * in `workspace/keyboard.ts`, the command list in `workspace/commands.ts`. That
 * split is what stops this becoming the 600-line component it replaced.
 *
 * The one piece of judgement here is what happens while the repository is still
 * loading: a spinner, not an empty state. "You have no semesters" is a claim,
 * and until the repository has answered it is one the app cannot make.
 */

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePlannerErrors, usePlannerState, useRepository } from "@/data/use-repository";
import {
  DEFAULT_PREFERENCES,
  EMPTY_SNAPSHOT,
  generateSampleDataset,
  toIsoDate,
  type Course,
  type Exam,
  type SampleDatasetId,
  type StudyBlock,
  type Topic,
} from "@/domain";
import {
  exportFilename,
  ImportError,
  parsePlannerJson,
  serializePlans,
} from "@/lib/import-export";
import { Button, EmptyState, Spinner } from "@/ui";
import { motionDuration } from "@/ui/motion";
import { AppSidebar } from "./app-sidebar";
import { AppToolbar } from "./app-toolbar";
import { CommandPalette } from "./command-palette";
import { Inspector } from "./inspector";
import { ConfirmDeleteSheet, ConfirmPlanDeleteSheet, EditPlanSheet, NewCourseSheet, NewPlanSheet, SampleDataSheet } from "./sheets";
import { ViewFade } from "./view-fade";
import { OutlineView } from "@/features/outline/outline-view";
import { TimelineView } from "@/features/timeline/timeline-view";
import { TodayView } from "@/features/today/today-view";
import { buildCommands } from "@/features/workspace/commands";
import {
  coursesInFocus,
  courseMatchesQuery,
  healthByCourse,
  resolveSelection,
  type ResolvedSelection,
} from "@/features/workspace/scope";
import { toggleRevealSelection, revealSelection, useWorkspace } from "@/features/workspace/store";

/**
 * What a click has to land on to leave the selection alone.
 *
 * Controls and the panels made of them, plus anything that manages its own
 * selection — the timeline clears on its own empty canvas, and doing it twice
 * would fight its box-select. Everything else is empty space.
 */
const KEEPS_SELECTION = [
  "[data-keeps-selection]",
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "label",
  '[role="slider"]',
  '[role="menu"]',
  '[role="dialog"]',
].join(", ");

/**
 * The last value that was not null.
 *
 * The inspector animates out over a quarter of a second, and an element that
 * has been handed `null` has nothing left to draw for that quarter second. The
 * selection is memoized upstream, so this adjusts state during render at most
 * once per genuine change.
 */
function useRetained<T>(value: T | null): T | null {
  const [kept, setKept] = useState(value);
  if (value !== null && value !== kept) setKept(value);

  // Dropped again once the panel has finished leaving. Held indefinitely — as
  // this did at first — the inspector's whole contents stay mounted behind a
  // zero-width panel for the rest of the session: a few hundred elements of
  // selects, checkboxes and sliders that every subsequent style recalculation
  // in the app has to walk, including the ones a drag on the timeline does
  // sixty times a second. The panel needs its contents for a quarter of a
  // second, so it keeps them for a quarter of a second.
  useEffect(() => {
    if (value !== null || kept === null) return;
    const timer = window.setTimeout(
      () => setKept(null),
      motionDuration(document.documentElement),
    );
    return () => window.clearTimeout(timer);
  }, [value, kept]);

  return value ?? kept;
}

/** Read once per mount: the planner is day-granular, so a re-render mid-day is not worth it. */
function useToday() {
  return useState(() => toIsoDate(new Date()))[0];
}

export function AppShell() {
  const repository = useRepository();
  const state = usePlannerState();
  const snapshot = state.status === "ready" ? state.snapshot : EMPTY_SNAPSHOT;
  const { error, run, clear } = usePlannerErrors();
  const { isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const today = useToday();

  const contentId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * Both side panels start closed on a narrow window and open on a wide one.
   * A 390px phone has room for exactly one column, and a sidebar that takes
   * two-thirds of it is not a sidebar. Read once, because a resize mid-session
   * is a deliberate act and should not throw away what the user has opened.
   */
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1024,
  );
  const [sampleDataOpen, setSampleDataOpen] = useState(false);
  const [editPlanOpen, setEditPlanOpen] = useState(false);
  const [deletePlanOpen, setDeletePlanOpen] = useState(false);

  const workspace = useWorkspace();

  const plan =
    snapshot.plans.find((candidate) => candidate.id === workspace.planId) ?? snapshot.plans[0];
  const health = useMemo(() => healthByCourse(plan, snapshot, today), [plan, snapshot, today]);
  // Every view draws exactly this list. The sidebar's switches and the focus
  // rows are filters over the whole workspace, not navigation into part of it.
  const focused = useMemo(
    () =>
      coursesInFocus(plan, workspace.focus, health, today, {
        hiddenCourseIds: workspace.hiddenCourseIds,
      }),
    [plan, workspace.focus, health, today, workspace.hiddenCourseIds],
  );
  const filteredFocused = useMemo(
    () => focused.filter((course) => courseMatchesQuery(workspace.query, course)),
    [focused, workspace.query],
  );
  const selection = useMemo(
    () => resolveSelection(plan, workspace.selection),
    [plan, workspace.selection],
  );
  // The inspector has no switch of its own: a selection that resolves is what
  // opens it, and a stale id left in the ephemeral store after its topic was
  // filtered out or deleted closes it again. `inspected` is the selection that
  // was last real, so the panel still has something to describe on the way out
  // — a deselect is a panel leaving, not a panel emptying and then leaving.
  const inspectorOpen = selection !== null;
  const inspected = useRetained(selection);
  const pendingDelete = useMemo(
    () => resolveSelection(plan, workspace.pendingDelete),
    [plan, workspace.pendingDelete],
  );

  /* ─── Actions ─────────────────────────────────────────────────────────── */

  const loadSampleData = (datasetId: SampleDatasetId) => {
    const seed = generateSampleDataset(datasetId, today);
    const preferences = seed.preferences;
    run(
      repository.replaceAll(
        serializePlans(
          {
            plans: [seed.plan],
            studyLog: seed.studyLog,
            preferences: preferences ?? DEFAULT_PREFERENCES,
          },
          today,
        ),
      ).then(() => (preferences ? repository.savePreferences(preferences) : undefined)),
    );
  };

  const exportJson = () => {
    const payload = serializePlans(snapshot, new Date().toISOString());
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const anchor = Object.assign(document.createElement("a"), {
      href: url,
      download: exportFilename(today),
    });
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    run(
      file.text().then(async (contents) => {
        try {
          await repository.importPlans(parsePlannerJson(contents));
        } catch (cause) {
          throw cause instanceof ImportError ? cause : new Error(String(cause));
        }
      }),
    );
  };

  const deleteResolved = (target: NonNullable<ResolvedSelection>) => {
    if (target.kind === "course") run(repository.deleteCourse(target.course.id));
    else if (target.kind === "topic") run(repository.deleteTopic(target.topic.id));
    else run(repository.deleteExam(target.exam.id));
    // The thing the inspector was describing is gone; leaving the id behind
    // would have `resolveSelection` return null anyway, but clearing it here
    // means the panel empties in the same commit as the delete.
    workspace.select(null);
  };

  // Selecting is not scoping. Clicking a course in the sidebar inspects it and
  // opens its section in the outline; clicking it again clears that selection.
  // It does not hide the other courses — narrowing to one is what the Focus
  // rows are for.
  const selectCourse = (course: Course) => toggleRevealSelection({ kind: "course", id: course.id });
  const selectTopic = (_course: Course, topic: Topic) =>
    toggleRevealSelection({ kind: "topic", id: topic.id });
  const selectExam = (_course: Course, exam: Exam) =>
    toggleRevealSelection({ kind: "exam", id: exam.id });

  /**
   * Following a reference out of the inspector.
   *
   * A block belongs to the timeline the way a topic belongs to the outline, so
   * clicking one goes there rather than trying to reproduce a chart inside a
   * 288px panel. The chart owns which bars are selected, so the id is handed
   * over as a request and cleared once the chart has honoured it.
   */
  const revealBlock = (block: StudyBlock) => {
    workspace.setView("timeline");
    workspace.revealBlock(block.id);
  };

  const revealTopic = (_course: Course, topic: Topic) => {
    workspace.setView("outline");
    revealSelection({ kind: "topic", id: topic.id });
  };

  /**
   * A click that lands on nothing lets the selection go.
   *
   * Every selectable thing in the app can be clicked again to deselect it, but
   * that only helps if you can find it — and after scrolling a semester you
   * often cannot. Empty space is the deselect that is always in reach. Controls
   * and the panels made of them are excluded, so pressing a button is never
   * also a deselect.
   */
  const clearSelectionOnEmptySpace = (event: React.MouseEvent) => {
    if (workspace.selection === null) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(KEEPS_SELECTION)) return;
    workspace.select(null);
  };

  /* ─── Command palette ─────────────────────────────────────────────────── */

  const commands = useMemo(
    () =>
      buildCommands({
        plan,
        hasData: snapshot.plans.length > 0,
        actions: {
          setView: workspace.setView,
          focusAll: () => workspace.setFocus({ kind: "all" }),
          focusAttention: () => workspace.setFocus({ kind: "attention" }),
          focusSoon: () => workspace.setFocus({ kind: "soon" }),
          revealCourse: selectCourse,
          revealTopic: (topic) => revealSelection({ kind: "topic", id: topic.id }),
          newSemester: () => workspace.setCreating("plan"),
          newCourse: () => workspace.setCreating("course"),
          loadSampleData: () => setSampleDataOpen(true),
          exportJson,
        },
      }),
    // `plan` and the snapshot are what the list is built from; the action
    // closures are stable enough that rebuilding on every render would only
    // cost the palette its memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, snapshot],
  );

  /* ─── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="flex h-screen flex-col overflow-hidden" onClick={clearSelectionOnEmptySpace}>
      <AppToolbar
        view={workspace.view}
        onViewChange={workspace.setView}
        contentId={contentId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onOpenPalette={() => workspace.setPaletteOpen(true)}
        onNewPlan={() => workspace.setCreating("plan")}
        onNewCourse={() => workspace.setCreating("course")}
        onLoadSampleData={() => setSampleDataOpen(true)}
        onExport={exportJson}
        onImport={importJson}
        canExport={snapshot.plans.length > 0}
        isAuthenticated={isAuthenticated}
        onSignIn={() => void signIn("github")}
        onSignOut={() => void signOut()}
      />

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-3 border-b border-separator bg-negative/10 px-4 py-2 text-body"
        >
          <span className="text-negative">{error.message}</span>
          <Button size="sm" variant="plain" className="ml-auto" onClick={clear}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <div
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
          data-panel-side="left"
          data-panel-state={sidebarOpen ? "open" : "closed"}
          className={`side-panel-shell absolute inset-y-0 left-0 z-30 flex w-60 overflow-hidden material-overlay shadow-popover lg:static lg:z-auto lg:bg-transparent lg:backdrop-filter-none lg:shadow-none ${
            sidebarOpen ? "" : "lg:w-0"
          }`}
        >
          {/* Overlaid on a narrow window, in the flow on a wide one: at 390px
              there is no room for two columns, and pushing the content off the
              screen is worse than covering it. The shell stays mounted so its
              entrance and exit share the same motion. */}
          <AppSidebar
            plans={snapshot.plans}
            plan={plan}
            health={health}
            today={today}
            focus={workspace.focus}
            hiddenCourseIds={workspace.hiddenCourseIds}
            query={workspace.query}
            searchRef={searchRef}
            selectedCourseId={workspace.selection?.kind === "course" ? workspace.selection.id : null}
            onSelectPlan={workspace.setPlan}
            onNewPlan={() => workspace.setCreating("plan")}
            onEditPlan={() => setEditPlanOpen(true)}
            onDeletePlan={() => setDeletePlanOpen(true)}
            onSetFocus={workspace.setFocus}
            onSetQuery={workspace.setQuery}
            onSelectCourse={selectCourse}
            onToggleHidden={(course) => workspace.toggleCourseHidden(course.id)}
            onHideAll={() => workspace.hideAllCourses((plan?.courses ?? []).map((c) => c.id))}
            onShowAll={workspace.showAllCourses}
            onNewCourse={() => workspace.setCreating("course")}
          />
        </div>

        <main id={contentId} className="min-w-0 flex-1 overflow-y-auto bg-content">
          {state.status === "loading" ? (
            <div className="flex h-full items-center justify-center">
              <Spinner label="Loading your plan" />
            </div>
          ) : !plan ? (
            <EmptyState
              title="No semesters yet"
              description="A semester holds your courses. Add one to get started, or load a full sample semester to see what the app looks like with real material in it."
              action={
                <Button
                  variant="accent"
                  leadingIcon={<Plus />}
                  onClick={() => setSampleDataOpen(true)}
                >
                  Load sample data
                </Button>
              }
            />
          ) : (
            <ViewFade
              view={workspace.view}
              // The chart runs its own reveal, and it is better at it than a
              // fade that cannot see what the chart is still doing.
              instant={["timeline"]}
              render={(view) =>
                view === "today" ? (
                  <TodayView
                    courses={filteredFocused}
                    health={health}
                    studyLog={snapshot.studyLog}
                    snapshot={snapshot}
                    today={today}
                    query={workspace.query}
                    selectedTopicId={
                      workspace.selection?.kind === "topic" ? workspace.selection.id : null
                    }
                    onSelectTopic={selectTopic}
                    onDeleteTopic={(_course, topic) =>
                      workspace.setPendingDelete({ kind: "topic", id: topic.id })
                    }
                    onGoToOutline={() => workspace.setView("outline")}
                  />
                ) : view === "timeline" ? (
                  <TimelineView
                    courses={filteredFocused}
                    health={health}
                    today={today}
                    query={workspace.query}
                    selectedId={workspace.selection?.id ?? null}
                    onSelectTopic={selectTopic}
                    onClearSelection={() => workspace.select(null)}
                    onGoToOutline={() => workspace.setView("outline")}
                  />
                ) : (
                  <OutlineView
                    courses={filteredFocused}
                    health={health}
                    today={today}
                    query={workspace.query}
                    snapshot={snapshot}
                    selectedId={workspace.selection?.id ?? null}
                    onSelectTopic={selectTopic}
                    onSelectExam={selectExam}
                    onDeleteTopic={(_course, topic) =>
                      workspace.setPendingDelete({ kind: "topic", id: topic.id })
                    }
                    onDeleteCourse={(course) =>
                      workspace.setPendingDelete({ kind: "course", id: course.id })
                    }
                    onNewCourse={() => workspace.setCreating("course")}
                  />
                )
              }
            />
          )}
        </main>

        <div
          aria-hidden={!inspectorOpen}
          inert={!inspectorOpen}
          data-panel-side="right"
          data-panel-state={inspectorOpen ? "open" : "closed"}
          // A column of its own once there is room for one, and an overlay only
          // on the narrow windows where a third column would leave the content
          // unreadable. An inspector that floats over the view it describes
          // covers the rows you are working through and has to be dismissed to
          // read them; beside the view, both are legible at once.
          className={`side-panel-shell absolute inset-y-0 right-0 z-30 flex w-72 overflow-hidden material-overlay shadow-popover lg:static lg:z-auto lg:bg-transparent lg:backdrop-filter-none lg:shadow-none ${
            inspectorOpen ? "" : "lg:w-0"
          }`}
        >
          <Inspector
            selection={inspected}
            health={health}
            today={today}
            onSelectCourse={selectCourse}
            onSelectTopic={revealTopic}
            onRevealBlock={revealBlock}
            onDelete={(target) =>
              workspace.setPendingDelete(
                target.kind === "course"
                  ? { kind: "course", id: target.course.id }
                  : target.kind === "topic"
                    ? { kind: "topic", id: target.topic.id }
                    : { kind: "exam", id: target.exam.id },
              )
            }
          />
        </div>
      </div>

      <CommandPalette
        open={workspace.paletteOpen}
        onOpenChange={workspace.setPaletteOpen}
        commands={commands}
      />

      <SampleDataSheet
        open={sampleDataOpen}
        onOpenChange={setSampleDataOpen}
        hasData={snapshot.plans.length > 0}
        onLoad={loadSampleData}
      />

      <NewPlanSheet
        open={workspace.creating === "plan"}
        onOpenChange={(open) => workspace.setCreating(open ? "plan" : null)}
        onCreate={(input) => run(repository.createPlan(input).then(workspace.setPlan))}
      />

      <EditPlanSheet
        plan={plan}
        open={editPlanOpen}
        onOpenChange={setEditPlanOpen}
        onSave={(input) => { if (plan) run(repository.updatePlan(plan.id, input)); }}
      />

      <ConfirmPlanDeleteSheet
        plan={plan}
        open={deletePlanOpen}
        onOpenChange={setDeletePlanOpen}
        onConfirm={() => {
          if (!plan) return;
          const nextPlan = snapshot.plans.find((candidate) => candidate.id !== plan.id);
          run(repository.deletePlan(plan.id).then(() => workspace.setPlan(nextPlan?.id ?? null)));
          workspace.select(null);
        }}
      />

      <NewCourseSheet
        open={workspace.creating === "course"}
        onOpenChange={(open) => workspace.setCreating(open ? "course" : null)}
        existing={plan?.courses ?? []}
        onCreate={(input) => {
          if (!plan) return;
          run(
            repository
              .createCourse(plan.id, input)
              .then((courseId) => revealSelection({ kind: "course", id: courseId })),
          );
        }}
      />

      <ConfirmDeleteSheet
        target={pendingDelete}
        onOpenChange={(open) => {
          if (!open) workspace.setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) deleteResolved(pendingDelete);
        }}
      />
    </div>
  );
}
