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
import { useId, useMemo, useRef, useState } from "react";
import { usePlannerErrors, usePlannerState, useRepository } from "@/data/use-repository";
import {
  DEFAULT_PREFERENCES,
  EMPTY_SNAPSHOT,
  generateSampleDataset,
  toIsoDate,
  type Course,
  type Exam,
  type SampleDatasetId,
  type Topic,
} from "@/domain";
import {
  exportFilename,
  ImportError,
  parsePlannerJson,
  serializePlans,
} from "@/lib/import-export";
import { Button, EmptyState, Spinner } from "@/ui";
import { AppSidebar } from "./app-sidebar";
import { AppToolbar } from "./app-toolbar";
import { CommandPalette } from "./command-palette";
import { Inspector } from "./inspector";
import { ConfirmDeleteSheet, ConfirmPlanDeleteSheet, EditPlanSheet, NewCourseSheet, NewPlanSheet, SampleDataSheet } from "./sheets";
import { OutlineView } from "@/features/outline/outline-view";
import { TimelineView } from "@/features/timeline/timeline-view";
import { TodayView } from "@/features/today/today-view";
import { buildCommands } from "@/features/workspace/commands";
import { isApplePlatform, shortcutLabel, useKeyboardMap } from "@/features/workspace/keyboard";
import {
  coursesInFocus,
  healthByCourse,
  resolveSelection,
  type ResolvedSelection,
} from "@/features/workspace/scope";
import { revealSelection, useWorkspace } from "@/features/workspace/store";

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
  const apple = useMemo(() => isApplePlatform(), []);

  const plan =
    snapshot.plans.find((candidate) => candidate.id === workspace.planId) ?? snapshot.plans[0];
  const health = useMemo(() => healthByCourse(plan, snapshot, today), [plan, snapshot, today]);
  // Every view draws exactly this list. The sidebar's switches and the focus
  // rows are filters over the whole workspace, not navigation into part of it.
  const focused = useMemo(
    () =>
      coursesInFocus(plan, workspace.focus, health, {
        hiddenCourseIds: workspace.hiddenCourseIds,
      }),
    [plan, workspace.focus, health, workspace.hiddenCourseIds],
  );
  const selection = useMemo(
    () => resolveSelection(plan, workspace.selection),
    [plan, workspace.selection],
  );
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
  // opens its section in the outline; it does not hide the other nine. Narrowing
  // to one course is what the Focus rows are for, and conflating the two is how
  // a sidebar click becomes something you undo.
  const selectCourse = (course: Course) => revealSelection({ kind: "course", id: course.id });
  const selectTopic = (_course: Course, topic: Topic) =>
    revealSelection({ kind: "topic", id: topic.id });
  const selectExam = (_course: Course, exam: Exam) =>
    revealSelection({ kind: "exam", id: exam.id });

  /* ─── Keyboard and palette ────────────────────────────────────────────── */

  useKeyboardMap({
    openPalette: () => workspace.setPaletteOpen(true),
    focusSearch: () => searchRef.current?.focus(),
    viewToday: () => workspace.setView("today"),
    viewTimeline: () => workspace.setView("timeline"),
    viewOutline: () => workspace.setView("outline"),
    toggleInspector: workspace.toggleInspector,
    newItem: () => workspace.setCreating(plan ? "course" : "plan"),
    deleteSelection: () => {
      if (workspace.selection) workspace.setPendingDelete(workspace.selection);
    },
    // Quick look: Space opens the inspector on whatever is selected, and closes
    // it again. Doing nothing without a selection is deliberate — opening an
    // empty panel is not a preview of anything.
    quickLook: () => {
      if (workspace.selection) workspace.toggleInspector();
    },
  });

  const commands = useMemo(
    () =>
      buildCommands({
        plan,
        hasData: snapshot.plans.length > 0,
        shortcut: (id) => shortcutLabel(id, apple),
        actions: {
          setView: workspace.setView,
          focusAll: () => workspace.setFocus({ kind: "all" }),
          focusBehind: () => workspace.setFocus({ kind: "behind" }),
          focusSoon: () => workspace.setFocus({ kind: "soon" }),
          revealCourse: selectCourse,
          revealTopic: (topic) => revealSelection({ kind: "topic", id: topic.id }),
          toggleInspector: workspace.toggleInspector,
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
    [plan, snapshot, apple],
  );

  /* ─── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppToolbar
        ref={searchRef}
        view={workspace.view}
        onViewChange={workspace.setView}
        contentId={contentId}
        query={workspace.query}
        onQueryChange={workspace.setQuery}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        inspectorOpen={workspace.inspectorOpen}
        onToggleInspector={workspace.toggleInspector}
        inspectorShortcut={shortcutLabel("toggleInspector", apple)}
        onNewPlan={() => workspace.setCreating("plan")}
        onNewCourse={() => workspace.setCreating("course")}
        newShortcut={shortcutLabel("newItem", apple)}
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
          className="flex items-center gap-3 border-b border-separator bg-red/10 px-4 py-2 text-body"
        >
          <span className="text-red">{error.message}</span>
          <Button size="sm" variant="plain" className="ml-auto" onClick={clear}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen ? (
          // Overlaid on a narrow window, in the flow on a wide one: at 390px
          // there is no room for two columns, and pushing the content off the
          // screen is worse than covering it.
          //
          // Frosted while overlaid, transparent when in the flow. The sidebar's
          // own material is tuned for a surface with nothing behind it and goes
          // unreadable on top of content; `material-overlay` is the denser
          // recipe for a panel that covers rather than abuts.
          <div className="absolute inset-y-0 left-0 z-30 flex material-overlay shadow-popover lg:static lg:z-auto lg:bg-transparent lg:backdrop-filter-none lg:shadow-none">
          <AppSidebar
            plans={snapshot.plans}
            plan={plan}
            health={health}
            focus={workspace.focus}
            hiddenCourseIds={workspace.hiddenCourseIds}
            query={workspace.query}
            onSelectPlan={workspace.setPlan}
            onNewPlan={() => workspace.setCreating("plan")}
            onEditPlan={() => setEditPlanOpen(true)}
            onDeletePlan={() => setDeletePlanOpen(true)}
            onSetFocus={workspace.setFocus}
            onToggleHidden={(course) => workspace.toggleCourseHidden(course.id)}
            onHideAll={() => workspace.hideAllCourses((plan?.courses ?? []).map((c) => c.id))}
            onShowAll={workspace.showAllCourses}
            onNewCourse={() => workspace.setCreating("course")}
          />
          </div>
        ) : null}

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
          ) : workspace.view === "today" ? (
            <TodayView
              courses={focused}
              health={health}
              studyLog={snapshot.studyLog}
              snapshot={snapshot}
              today={today}
              selectedTopicId={workspace.selection?.kind === "topic" ? workspace.selection.id : null}
              onSelectTopic={selectTopic}
              onDeleteTopic={(_course, topic) =>
                workspace.setPendingDelete({ kind: "topic", id: topic.id })
              }
              onGoToOutline={() => workspace.setView("outline")}
            />
          ) : workspace.view === "timeline" ? (
            <TimelineView
              courses={focused}
              health={health}
              today={today}
              selectedId={workspace.selection?.id ?? null}
              onSelectTopic={selectTopic}
              onGoToOutline={() => workspace.setView("outline")}
            />
          ) : (
            <OutlineView
              courses={focused}
              health={health}
              today={today}
              query={workspace.query}
              snapshot={snapshot}
              selectedId={workspace.selection?.id ?? null}
              onSelectCourse={selectCourse}
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
          )}
        </main>

        {workspace.inspectorOpen ? (
          <div className="absolute inset-y-0 right-0 z-30 flex material-overlay shadow-popover lg:static lg:z-auto lg:bg-transparent lg:backdrop-filter-none lg:shadow-none">
          <Inspector
            selection={selection}
            health={health}
            today={today}
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
        ) : null}
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
