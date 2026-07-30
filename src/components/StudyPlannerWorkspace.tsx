"use client";

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import {
  CalendarDays,
  Clock3,
  GanttChart,
  GraduationCap,
  ListTree,
  PanelRight,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  usePlannerErrors,
  usePlannerState,
  useRepository,
} from "@/data/use-repository";
import {
  DEFAULT_PREFERENCES,
  EMPTY_SNAPSHOT,
  generateSeedData,
  leastUsedColor,
  scheduleCourses,
  toIsoDate,
  type Course,
  type Plan,
  type Unit,
} from "@/domain";
import {
  EXPORT_VERSION,
  exportFilename,
  ImportError,
  parsePlannerJson,
  serializePlans,
} from "@/lib/import-export";
import { CommandPalette, type PaletteCommand } from "@/features/command-palette/CommandPalette";
import { InspectorPane } from "@/features/inspector/InspectorPane";
import { OutlineView } from "@/features/outline/OutlineView";
import {
  CreateItemSheet,
  type ItemKind,
} from "@/features/shell/CreateItemSheet";
import { DeleteSelectionSheet } from "@/features/shell/DeleteSelectionSheet";
import { PlannerSidebar } from "@/features/shell/PlannerSidebar";
import { WorkspaceToolbar } from "@/features/shell/WorkspaceToolbar";
import {
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/shell/workspace-store";
import { TimelineView } from "@/features/timeline/TimelineView";
import { TodayView } from "@/features/today/TodayView";
import { Button, EmptyState, Sheet, Spinner } from "@/ui";

function useToday() {
  return useState(() => toIsoDate(new Date()))[0];
}

export function StudyPlannerApp() {
  const repository = useRepository();
  const repositoryState = usePlannerState();
  const snapshot = repositoryState.status === "ready" ? repositoryState.snapshot : EMPTY_SNAPSHOT;
  const { error, run, clear } = usePlannerErrors();
  const { isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const today = useToday();
  const savedCapacity = snapshot.preferences.dailyCapacityUnits;
  const [capacityDraft, setCapacityDraft] = useState<{
    planId: string | null;
    value: string;
  } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [createKind, setCreateKind] = useState<ItemKind | undefined>();
  const [sampleConfirmationOpen, setSampleConfirmationOpen] = useState(false);

  const view = useWorkspaceStore((state) => state.view);
  const smartView = useWorkspaceStore((state) => state.smartView);
  const planId = useWorkspaceStore((state) => state.planId);
  const courseId = useWorkspaceStore((state) => state.courseId);
  const selection = useWorkspaceStore((state) => state.selection);
  const inspectorOpen = useWorkspaceStore((state) => state.inspectorOpen);
  const commandOpen = useWorkspaceStore((state) => state.commandOpen);
  const commandQuery = useWorkspaceStore((state) => state.commandQuery);
  const createOpen = useWorkspaceStore((state) => state.createOpen);
  const deleteOpen = useWorkspaceStore((state) => state.deleteOpen);
  const setView = useWorkspaceStore((state) => state.setView);
  const activateSmartView = useWorkspaceStore((state) => state.activateSmartView);
  const selectPlan = useWorkspaceStore((state) => state.selectPlan);
  const selectCourse = useWorkspaceStore((state) => state.selectCourse);
  const selectTopic = useWorkspaceStore((state) => state.selectTopic);
  const clearSelection = useWorkspaceStore((state) => state.clearSelection);
  const toggleInspector = useWorkspaceStore((state) => state.toggleInspector);
  const setInspectorOpen = useWorkspaceStore((state) => state.setInspectorOpen);
  const openCommand = useWorkspaceStore((state) => state.openCommand);
  const setCommandOpen = useWorkspaceStore((state) => state.setCommandOpen);
  const setCommandQuery = useWorkspaceStore((state) => state.setCommandQuery);
  const setCreateOpen = useWorkspaceStore((state) => state.setCreateOpen);
  const setDeleteOpen = useWorkspaceStore((state) => state.setDeleteOpen);

  const plan = resolvePlan(snapshot.plans, planId);
  const course = resolveCourse(plan, courseId);
  const capacity =
    capacityDraft?.planId === (plan?.id ?? null)
      ? capacityDraft.value
      : savedCapacity === undefined
        ? ""
        : String(savedCapacity);

  const schedule = useMemo(
    () =>
      scheduleCourses({
        courses: plan?.courses ?? [],
        today,
        preferences: snapshot.preferences,
        // Empty and temporarily-invalid editing states stay a What-if preview;
        // saved preferences change only when the user applies the schedule.
        dailyCapacityUnits: Number(capacity),
      }),
    [capacity, plan?.courses, snapshot.preferences, today],
  );

  const hasAutoSchedule = useMemo(
    () =>
      Boolean(
        plan?.courses.some((candidate) =>
          candidate.topics.some((topic) =>
            topic.blocks.some((block) => block.source === "auto" && block.endDate >= today),
          ),
        ),
      ),
    [plan?.courses, today],
  );

  const applySchedule = useCallback(() => {
    if (!plan || schedule.capacityUnits === null || planning) return;
    const inScope = new Set(
      schedule.courses
        .filter((item) => item.deadline !== null)
        .map((item) => item.courseId),
    );
    const topicIds = plan.courses
      .filter((candidate) => inScope.has(candidate.id))
      .flatMap((candidate) => candidate.topics.map((topic) => topic.id));
    const nextPreferences = {
      ...snapshot.preferences,
      dailyCapacityUnits: schedule.capacityUnits,
    };

    setPlanning(true);
    run(
      (async () => {
        await repository.savePreferences(nextPreferences);
        await repository.replaceAutoBlocks(topicIds, schedule.blocks, { fromDate: today });
      })().finally(() => setPlanning(false)),
    );
  }, [plan, planning, repository, run, schedule, snapshot.preferences, today]);

  useEffect(() => {
    if (!plan || plan.id === planId) return;
    useWorkspaceStore.setState({
      planId: plan.id,
      courseId: plan.courses[0]?.id ?? null,
      selection: plan.courses[0] ? { kind: "course", id: plan.courses[0].id } : null,
    });
  }, [plan, planId]);

  useEffect(() => {
    if (!plan || !course || course.id === courseId) return;
    useWorkspaceStore.setState({
      courseId: course.id,
      selection: { kind: "course", id: course.id },
    });
  }, [course, courseId, plan]);

  const loadSampleData = () => {
    const seed = generateSeedData({ today });
    run(
      repository
        .replaceAll(
          serializePlans(
            { plans: [seed.plan], studyLog: seed.studyLog, preferences: DEFAULT_PREFERENCES },
            today,
          ),
        )
        .then(() => useWorkspaceStore.setState({ planId: seed.plan.id, courseId: null })),
    );
  };

  const exportJson = () => {
    const document = serializePlans(snapshot, new Date().toISOString());
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }),
    );
    const anchor = Object.assign(window.document.createElement("a"), {
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

  const createPlan = (name: string) => {
    run(repository.createPlan({ name }).then((id) => selectPlan(id)));
  };

  const createCourse = (name: string) => {
    if (!plan) return;
    const color = leastUsedColor(plan.courses.map((candidate) => candidate.color));
    run(repository.createCourse(plan.id, { name, color }).then((id) => selectCourse(id)));
  };

  const createTopic = (input: { name: string; unit: Unit; totalUnits: number }) => {
    if (!course) return;
    run(
      repository
        .createTopic(course.id, { ...input, color: course.color })
        .then((id) => selectTopic(id, course.id)),
    );
  };

  const openCreate = useCallback(
    (kind?: ItemKind) => {
      setCreateKind(kind);
      setCreateOpen(true);
    },
    [setCreateOpen],
  );

  const deleteCourse = (id: string) => {
    clearSelection();
    useWorkspaceStore.setState({ courseId: null });
    run(repository.deleteCourse(id));
  };

  const deleteTopic = (id: string) => {
    clearSelection();
    run(repository.deleteTopic(id));
  };

  const selectView = useCallback(
    (nextView: WorkspaceView) => {
      setView(nextView);
      if (nextView === "outline" && course) {
        useWorkspaceStore.setState({ selection: { kind: "course", id: course.id } });
      }
    },
    [course, setView],
  );

  const commands = useMemo<PaletteCommand[]>(() => {
    const base: PaletteCommand[] = [
      {
        id: "view-today",
        label: "Show Today",
        category: "View",
        shortcut: "⌘1",
        icon: <CalendarDays />,
        keywords: ["home", "study"],
        run: () => selectView("today"),
      },
      {
        id: "view-timeline",
        label: "Show Timeline",
        category: "View",
        shortcut: "⌘2",
        icon: <GanttChart />,
        keywords: ["schedule", "agenda"],
        run: () => selectView("timeline"),
      },
      {
        id: "view-outline",
        label: "Show Outline",
        category: "View",
        shortcut: "⌘3",
        icon: <ListTree />,
        keywords: ["topics", "setup"],
        run: () => selectView("outline"),
      },
      {
        id: "smart-upcoming",
        label: "Show upcoming exams",
        category: "Smart view",
        icon: <Clock3 />,
        run: () => activateSmartView("upcoming"),
      },
      {
        id: "smart-behind",
        label: "Show courses behind pace",
        category: "Smart view",
        icon: <TriangleAlert />,
        run: () => activateSmartView("behind"),
      },
      {
        id: "action-new",
        label: "Create new item",
        category: "Action",
        shortcut: "⌘N",
        icon: <Plus />,
        run: () => openCreate(),
      },
      {
        id: "action-inspector",
        label: inspectorOpen ? "Hide inspector" : "Show inspector",
        category: "Action",
        shortcut: "⌥⌘I",
        icon: <PanelRight />,
        run: toggleInspector,
      },
      {
        id: "action-delete",
        label: "Delete selection",
        category: "Action",
        shortcut: "⌘⌫",
        icon: <Trash2 />,
        disabled: !selection,
        run: () => setDeleteOpen(true),
      },
    ];

    if (!plan) return base;

    for (const candidate of plan.courses) {
      base.push({
        id: `course-${candidate.id}`,
        label: candidate.name,
        detail: "Open course outline",
        category: "Course",
        icon: <GraduationCap />,
        run: () => selectCourse(candidate.id),
      });
      for (const topic of candidate.topics) {
        base.push({
          id: `topic-${topic.id}`,
          label: topic.name,
          detail: candidate.name,
          category: "Topic",
          icon: <Search />,
          keywords: topic.section ? [topic.section] : undefined,
          run: () => selectTopic(topic.id, candidate.id),
        });
      }
    }
    return base;
  }, [
    activateSmartView,
    inspectorOpen,
    plan,
    selection,
    selectCourse,
    selectView,
    selectTopic,
    openCreate,
    setDeleteOpen,
    toggleInspector,
  ]);

  useKeyboardMap({
    selectionPresent: Boolean(selection),
    onOpenCommand: openCommand,
    onViewChange: selectView,
    onCreate: () => openCreate(),
    onDelete: () => setDeleteOpen(true),
    onToggleInspector: toggleInspector,
  });

  const toolbar = (
    <WorkspaceToolbar
      planName={plan?.name ?? "No semester"}
      view={view}
      inspectorOpen={inspectorOpen}
      authenticated={isAuthenticated}
      canExport={snapshot.plans.length > 0}
      onViewChange={selectView}
      onOpenCommand={() => openCommand()}
      onCreate={() => openCreate()}
      onToggleInspector={toggleInspector}
      onLoadSample={() => {
        if (snapshot.plans.length > 0) setSampleConfirmationOpen(true);
        else loadSampleData();
      }}
      onExport={exportJson}
      onImport={importJson}
      onSignIn={() => void signIn("github")}
      onSignOut={() => void signOut()}
    />
  );

  if (repositoryState.status === "loading") {
    return (
      <div className="flex h-screen flex-col overflow-hidden">
        {toolbar}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-content">
          <Spinner label="Loading your plan" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {toolbar}

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

      {plan ? (
        <div className="flex min-h-0 flex-1">
          <PlannerSidebar
            snapshot={snapshot}
            plan={plan}
            today={today}
            view={view}
            smartView={smartView}
            courseId={courseId}
            onSelectPlan={selectPlan}
            onSelectSmartView={activateSmartView}
            onSelectCourse={selectCourse}
            onCreate={() => openCreate()}
            onCreateCourse={() => openCreate("course")}
          />

          <main className="min-w-0 flex-1 overflow-y-auto bg-content">
            {view === "today" ? (
              <TodayView
                plan={plan}
                snapshot={snapshot}
                today={today}
                smartView={smartView}
                onSelectCourse={selectCourse}
                onSelectTopic={selectTopic}
                onCreate={() => openCreate()}
                schedule={schedule}
                capacity={capacity}
                hasAutoSchedule={hasAutoSchedule}
                planning={planning}
                onCapacityChange={(value) =>
                  setCapacityDraft({ planId: plan.id, value })
                }
                onApplySchedule={applySchedule}
                onLogStudy={(topicId, units) =>
                  run(repository.logStudy({ topicId, date: today, units }))
                }
              />
            ) : view === "timeline" ? (
              <TimelineView
                plan={plan}
                today={today}
                onCreate={() => openCreate()}
                onSelectTopic={selectTopic}
              />
            ) : (
              <OutlineView
                plan={plan}
                course={course}
                selection={selection}
                today={today}
                onCreateCourse={createCourse}
                onSelectCourse={selectCourse}
                onSelectTopic={selectTopic}
              />
            )}
          </main>

          {inspectorOpen ? (
            <InspectorPane
              plan={plan}
              snapshot={snapshot}
              selection={selection}
              today={today}
              onClose={() => setInspectorOpen(false)}
              onLogStudy={(input) => run(repository.logStudy(input))}
            />
          ) : null}
        </div>
      ) : (
        <main className="min-h-0 flex-1 bg-content">
          <EmptyState
            title="No semesters yet"
            description="A semester holds your courses. Create one to begin, or load realistic sample data."
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="accent"
                  leadingIcon={<Plus />}
                  onClick={() => openCreate("semester")}
                >
                  New semester
                </Button>
                <Button onClick={loadSampleData}>Load sample data</Button>
              </div>
            }
            className="h-full"
          />
        </main>
      )}

      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        commands={commands}
      />
      {createOpen ? (
        <CreateItemSheet
          open
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) setCreateKind(undefined);
          }}
          plan={plan}
          course={course}
          initialKind={createKind}
          onCreatePlan={createPlan}
          onCreateCourse={createCourse}
          onCreateTopic={createTopic}
        />
      ) : null}
      {sampleConfirmationOpen ? (
        <Sheet
          open
          onOpenChange={setSampleConfirmationOpen}
          title="Replace with sample data?"
          description="The sample semester will replace every semester and study-history entry on this account."
          footer={
            <>
              <Button onClick={() => setSampleConfirmationOpen(false)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  setSampleConfirmationOpen(false);
                  loadSampleData();
                }}
              >
                Replace data
              </Button>
            </>
          }
        >
          <p className="text-body text-secondary">Export first if you want a backup.</p>
        </Sheet>
      ) : null}
      {plan ? (
        <DeleteSelectionSheet
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          plan={plan}
          selection={selection}
          onDeleteCourse={deleteCourse}
          onDeleteTopic={deleteTopic}
        />
      ) : null}

      <span className="sr-only">Export format v{EXPORT_VERSION}</span>
    </div>
  );
}

function resolvePlan(plans: Plan[], planId: string | null) {
  return plans.find((candidate) => candidate.id === planId) ?? plans[0] ?? null;
}

function resolveCourse(plan: Plan | null, courseId: string | null): Course | null {
  return plan?.courses.find((candidate) => candidate.id === courseId) ?? plan?.courses[0] ?? null;
}

function useKeyboardMap({
  selectionPresent,
  onOpenCommand,
  onViewChange,
  onCreate,
  onDelete,
  onToggleInspector,
}: {
  selectionPresent: boolean;
  onOpenCommand: (query?: string) => void;
  onViewChange: (view: WorkspaceView) => void;
  onCreate: () => void;
  onDelete: () => void;
  onToggleInspector: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const command = event.metaKey || event.ctrlKey;

      if (command && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        onOpenCommand();
      } else if (command && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        onOpenCommand();
      } else if (command && event.key === "1") {
        event.preventDefault();
        onViewChange("today");
      } else if (command && event.key === "2") {
        event.preventDefault();
        onViewChange("timeline");
      } else if (command && event.key === "3") {
        event.preventDefault();
        onViewChange("outline");
      } else if (command && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        onCreate();
      } else if (command && event.altKey && event.key.toLocaleLowerCase() === "i") {
        event.preventDefault();
        onToggleInspector();
      } else if (command && event.key === "Backspace" && selectionPresent) {
        event.preventDefault();
        onDelete();
      } else if (
        !command &&
        event.key === " " &&
        selectionPresent &&
        !isNativeActivationTarget(event.target)
      ) {
        event.preventDefault();
        onToggleInspector();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    onCreate,
    onDelete,
    onOpenCommand,
    onToggleInspector,
    onViewChange,
    selectionPresent,
  ]);
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function isNativeActivationTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'button, a[href], summary, [role="button"], [role="checkbox"], [role="menuitem"], [role="radio"]',
      ),
    )
  );
}
