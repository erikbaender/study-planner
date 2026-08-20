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

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, useMemo, useRef, useState } from "react";
import { usePlannerAuth } from "@/auth/use-planner-auth";
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
  MAX_PLANNER_IMPORT_BYTES,
  MAX_PLANNER_IMPORT_MIB,
  serializePlans,
} from "@/lib/planner-transfer";
import { Button, EmptyState, Spinner } from "@/ui";
import { AppSidebar } from "./app-sidebar";
import { AppToolbar } from "./app-toolbar";
import { CommandPalette } from "./command-palette";
import { Inspector, isInspectable } from "./inspector";
import {
  ConfirmDeleteSheet,
  ConfirmPlanDeleteSheet,
  EditCourseSheet,
  EditPlanSheet,
  NewCourseSheet,
  NewPlanSheet,
  SampleDataSheet,
} from "./sheets";
import { useViewFadeHold, ViewFade } from "./view-fade";
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

function ViewLoadingFallback({ label }: { label: string }) {
  // The hook releases its hold when this fallback unmounts, so a loaded view
  // enters through the existing ViewFade instead of replacing a visible spinner.
  useViewFadeHold();

  return (
    <div aria-busy="true" className="flex h-full min-h-64 w-full items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

const TimelineView = dynamic(
  () =>
    import("@/features/timeline/timeline-view").then(({ TimelineView }) => TimelineView),
  { loading: () => <ViewLoadingFallback label="Loading timeline" /> },
);

const OutlineView = dynamic(
  () => import("@/features/outline/outline-view").then(({ OutlineView }) => OutlineView),
  { loading: () => <ViewLoadingFallback label="Loading outline" /> },
);

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

/** Read once per mount: the planner is day-granular, so a re-render mid-day is not worth it. */
function useToday() {
  return useState(() => toIsoDate(new Date()))[0];
}

export function AppShell() {
  const repository = useRepository();
  const state = usePlannerState();
  const snapshot = state.status === "ready" ? state.snapshot : EMPTY_SNAPSHOT;
  const { error, run, clear } = usePlannerErrors();
  const auth = usePlannerAuth();
  const today = useToday();

  const contentId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * Both side panels start closed on a narrow window and open on a wide one.
   * A 390px phone has room for exactly one column, and a sidebar that takes
   * two-thirds of it is not a sidebar. CSS keeps both panels out of the compact
   * layout entirely, including when a selection would open the inspector.
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
  // filtered out or deleted closes it again. The inspector owns the brief
  // retention needed for its sequential content fade.
  const inspectable = isInspectable(selection) ? selection : null;
  const inspectorOpen = inspectable !== null;

  const pendingDelete = useMemo(
    () => resolveSelection(plan, workspace.pendingDelete),
    [plan, workspace.pendingDelete],
  );
  // Held as an id rather than as the course itself, so an edit made in the
  // sheet is reflected in its own title rather than by a stale copy.
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const editingCourse = plan?.courses.find((course) => course.id === editingCourseId);

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
    if (file.size > MAX_PLANNER_IMPORT_BYTES) {
      run(Promise.reject(new Error(`Planner files must be ${MAX_PLANNER_IMPORT_MIB} MiB or smaller.`)));
      return;
    }

    run(
      (async () => {
        const [{ ImportError, parsePlannerJson }, contents] = await Promise.all([
          import("@/lib/import-export"),
          file.text(),
        ]);
        try {
          await repository.importPlans(parsePlannerJson(contents));
        } catch (cause) {
          throw cause instanceof ImportError ? cause : new Error(String(cause));
        }
      })(),
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

  const selectCourse = (course: Course) => toggleRevealSelection({ kind: "course", id: course.id });

  /**
   * A course's name in the outline was clicked.
   *
   * The card's fold state is the outline's own business — this only follows
   * what its name says, and clearing only ever applies to *this* course, so
   * letting one course go cannot deselect the topic you are working on in
   * another.
   */
  const applyCourseSelection = (course: Course, selected: boolean) => {
    if (selected) revealSelection({ kind: "course", id: course.id });
    else if (workspace.selection?.kind === "course" && workspace.selection.id === course.id)
      workspace.select(null);
  };

  /**
   * The sidebar's course list is a filter, not a selection surface.
   *
   * Clicking a row there takes you to the course in the outline and opens it —
   * it does not select it, because the sidebar is where you decide what is in
   * scope, and a click that both scoped and inspected made the two impossible
   * to tell apart. Selection happens on the card itself.
   */
  const revealCourseInOutline = (course: Course) => {
    workspace.revealCourse(course.id);
  };

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
        authStatus={auth.status}
        onSignIn={() => void auth.signIn()}
        onSignOut={() => void auth.signOut()}
      />

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-3 border-b border-separator bg-negative/10 px-4 py-2 text-body"
        >
          <span className="text-negative">{error.message}</span>
          {state.status !== "error" ? (
            <Button size="sm" variant="plain" className="ml-auto" onClick={clear}>
              Dismiss
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <div
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
          data-panel-side="left"
          data-panel-state={sidebarOpen ? "open" : "closed"}
          className={`side-panel-shell hidden w-60 overflow-hidden lg:static lg:flex ${
            sidebarOpen ? "" : "lg:w-0"
          }`}
        >
          {/* Panels belong to the desktop split view. Compact windows get the
              content column only, rather than drawers covering that content. */}
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
            onSelectCourse={revealCourseInOutline}
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
          ) : state.status === "error" ? (
            <EmptyState
              title="Couldn’t load your plan"
              description="Your data has not been changed. Check this browser’s storage access or your sync connection, then try again."
              action={<Button onClick={() => window.location.reload()}>Reload</Button>}
            />
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
                    onSelectCourse={applyCourseSelection}
                    onDeleteExam={(_course, exam) =>
                      workspace.setPendingDelete({ kind: "exam", id: exam.id })
                    }
                    onDeleteTopic={(_course, topic) =>
                      workspace.setPendingDelete({ kind: "topic", id: topic.id })
                    }
                    onDeleteCourse={(course) =>
                      workspace.setPendingDelete({ kind: "course", id: course.id })
                    }
                    onEditCourse={(courseId) => setEditingCourseId(courseId)}
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
          // The inspector is a desktop column only. On compact windows the
          // selection remains useful to the view, but no panel covers it.
          className={`side-panel-shell hidden w-72 overflow-hidden lg:static lg:flex ${
            inspectorOpen ? "" : "lg:w-0"
          }`}
        >
          <Inspector
            selection={inspectable}
            today={today}
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

      <EditCourseSheet
        course={editingCourse}
        open={editingCourse !== undefined}
        onOpenChange={(open) => setEditingCourseId(open ? editingCourseId : null)}
        onSave={(input) => {
          if (editingCourse) run(repository.updateCourse(editingCourse.id, input));
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
