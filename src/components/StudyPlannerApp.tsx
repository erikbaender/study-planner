"use client";

import { addDays, differenceInCalendarDays, format, formatISO, isBefore, min, parseISO } from "date-fns";
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  GitBranch,
  Download,
  GripHorizontal,
  Link2,
  LogIn,
  Milestone,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { IonButton, IonInput, IonModal, IonTextarea, setupIonicReact } from "@ionic/react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { clsx } from "clsx";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  applePalette,
  createId,
  leastUsedColor,
  samplePlans,
  type Course,
  type Milestone as MilestoneType,
  type Plan,
  type Topic,
} from "@/lib/planner-data";
import { fetchGitHubIssues, mapGitHubIssuesToPlan, parsePlannerJson, serializePlans } from "@/lib/import-export";

setupIonicReact({ mode: "ios" });

type Selection =
  | { type: "plan"; planId: string }
  | { type: "course"; planId: string; courseId: string }
  | { type: "topic"; planId: string; courseId: string; topicId: string }
  | { type: "milestone"; planId: string; courseId: string; milestoneId: string };

type DragState = {
  mode: "move" | "start" | "end";
  planId: string;
  courseId: string;
  topicId: string;
  rangeId: string;
  originX: number;
  originStart: string;
  originEnd: string;
};

type ModalMode =
  | "plan"
  | "course"
  | "topic"
  | "milestone"
  | "range"
  | "edit-plan"
  | "edit-course"
  | "edit-topic"
  | "edit-milestone"
  | "edit-range"
  | "dependencies"
  | "github"
  | null;

type GitHubImportPreview = {
  issueCount: number;
  planName: string;
  repository: string;
  courses: Array<{ name: string; topicCount: number; milestoneCount: number; rangeCount: number }>;
};

type DeleteTarget =
  | { kind: "selection"; title: string; detail: string }
  | { kind: "range"; rangeId: string; courseId: string; topicId: string; title: string; detail: string };

const dayWidth = 42;
const today = "2026-05-01";

export function StudyPlannerApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [localPlans, setLocalPlans] = useState<Plan[]>(samplePlans);
  const [activePlanId, setActivePlanId] = useState(samplePlans[0]?.id ?? "");
  const [selection, setSelection] = useState<Selection>({ type: "plan", planId: samplePlans[0]?.id ?? "" });
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingRangeId, setEditingRangeId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [toast, setToast] = useState("Ready");
  const seededSampleData = useRef(false);

  const convexAuth = useConvexAuth();
  const usingConvex = convexAuth.isAuthenticated && !signedIn;
  const remotePlanTrees = useQuery(api.planner.listPlanTrees, usingConvex ? {} : "skip");
  const createPlanMutation = useMutation(api.planner.createPlan);
  const createCourseMutation = useMutation(api.planner.createCourse);
  const createTopicMutation = useMutation(api.planner.createTopic);
  const createMilestoneMutation = useMutation(api.planner.createMilestone);
  const createTopicRangeMutation = useMutation(api.planner.createTopicRange);
  const updatePlanMutation = useMutation(api.planner.updatePlan);
  const updateCourseMutation = useMutation(api.planner.updateCourse);
  const updateTopicMutation = useMutation(api.planner.updateTopic);
  const updateMilestoneMutation = useMutation(api.planner.updateMilestone);
  const updateTopicRangeMutation = useMutation(api.planner.updateTopicRange);
  const updateTopicDependenciesMutation = useMutation(api.planner.updateTopicDependencies);
  const deletePlanMutation = useMutation(api.planner.deletePlan);
  const deleteCourseMutation = useMutation(api.planner.deleteCourse);
  const deleteTopicMutation = useMutation(api.planner.deleteTopic);
  const deleteMilestoneMutation = useMutation(api.planner.deleteMilestone);
  const deleteTopicRangeMutation = useMutation(api.planner.deleteTopicRange);
  const importPlanTreesMutation = useMutation(api.planner.importPlanTrees);
  const previewGitHubIssuesAction = useAction(api.github.previewIssues);
  const importGitHubIssuesAction = useAction(api.github.importIssues);
  const remotePlans = useMemo(() => (remotePlanTrees ? mapConvexPlanTrees(remotePlanTrees) : undefined), [remotePlanTrees]);
  const plans = useMemo(() => (usingConvex ? remotePlans ?? [] : localPlans), [localPlans, remotePlans, usingConvex]);

  const activePlan = plans.find((plan) => plan.id === activePlanId) ?? plans[0];
  const selectedCourse = selection.type !== "plan" ? activePlan?.courses.find((course) => course.id === selection.courseId) : undefined;
  const selectedTopic = selection.type === "topic" ? selectedCourse?.topics.find((topic) => topic.id === selection.topicId) : undefined;
  const selectedMilestone = selection.type === "milestone" ? selectedCourse?.milestones.find((milestone) => milestone.id === selection.milestoneId) : undefined;
  const selectedRange = selectedTopic?.ranges.find((range) => range.id === editingRangeId);

  const timeline = useMemo(() => buildTimeline(activePlan), [activePlan]);

  useEffect(() => {
    if (!usingConvex || remotePlanTrees === undefined || remotePlanTrees.length !== 0 || seededSampleData.current) {
      return;
    }

    seededSampleData.current = true;
    setToast("Creating starter plan");
    void importPlanTreesMutation({ plans: toImportPlanInputs(samplePlans) })
      .then((planIds) => {
        const firstPlanId = String(planIds[0] ?? "");
        if (firstPlanId) {
          setActivePlanId(firstPlanId);
          setSelection({ type: "plan", planId: firstPlanId });
        }
        setToast("Starter plan saved");
      })
      .catch((error) => {
        seededSampleData.current = false;
        setToast(error instanceof Error ? error.message : "Starter plan failed");
      });
  }, [importPlanTreesMutation, remotePlanTrees, usingConvex]);

  function updatePlans(updater: (plans: Plan[]) => Plan[]) {
    setLocalPlans((current) => updater(structuredClone(current)));
  }

  async function addPlan(name: string, notes: string) {
    if (usingConvex) {
      const planId = String(await createPlanMutation({ name, notes }));
      setActivePlanId(planId);
      setSelection({ type: "plan", planId });
      setToast("Plan saved");
      return;
    }

    const plan: Plan = { id: createId("plan"), name, notes, courses: [] };
    updatePlans((current) => [...current, plan]);
    setActivePlanId(plan.id);
    setSelection({ type: "plan", planId: plan.id });
    setToast("Plan created");
  }

  async function addCourse(name: string, notes: string, color = leastUsedColor(plans)) {
    if (!activePlan) return;
    if (usingConvex) {
      const courseId = String(await createCourseMutation({ planId: activePlan.id as Id<"plans">, name, notes, color }));
      setSelection({ type: "course", planId: activePlan.id, courseId });
      setToast("Course saved");
      return;
    }

    const course: Course = { id: createId("course"), planId: activePlan.id, name, notes, color, milestones: [], topics: [] };
    updatePlans((current) =>
      current.map((plan) => (plan.id === activePlan.id ? { ...plan, courses: [...plan.courses, course] } : plan)),
    );
    setSelection({ type: "course", planId: activePlan.id, courseId: course.id });
    setToast("Course added");
  }

  async function addTopic(name: string, notes: string, color = selectedCourse?.color ?? leastUsedColor(plans)) {
    if (!activePlan || !selectedCourse) return;
    if (usingConvex) {
      const topicId = String(await createTopicMutation({ courseId: selectedCourse.id as Id<"courses">, name, notes, color }));
      setSelection({ type: "topic", planId: activePlan.id, courseId: selectedCourse.id, topicId });
      setToast("Topic saved");
      return;
    }

    const topic: Topic = { id: createId("topic"), courseId: selectedCourse.id, name, notes, color, dependencies: [], ranges: [] };
    updateCourse(selectedCourse.id, (course) => ({ ...course, topics: [...course.topics, topic] }));
    setSelection({ type: "topic", planId: activePlan.id, courseId: selectedCourse.id, topicId: topic.id });
    setToast("Topic added");
  }

  async function addMilestone(name: string, notes: string, start: string, end?: string) {
    if (!activePlan || !selectedCourse) return;
    if (usingConvex) {
      const milestoneId = String(
        await createMilestoneMutation({
          courseId: selectedCourse.id as Id<"courses">,
          name,
          notes,
          startDate: start,
          endDate: end,
        }),
      );
      setSelection({ type: "milestone", planId: activePlan.id, courseId: selectedCourse.id, milestoneId });
      setToast("Milestone saved");
      return;
    }

    const milestone: MilestoneType = { id: createId("milestone"), courseId: selectedCourse.id, name, notes, start, end };
    updateCourse(selectedCourse.id, (course) => ({ ...course, milestones: [...course.milestones, milestone] }));
    setSelection({ type: "milestone", planId: activePlan.id, courseId: selectedCourse.id, milestoneId: milestone.id });
    setToast("Milestone added");
  }

  async function addRange(start: string, end: string) {
    if (!selectedCourse || !selectedTopic) return;
    const normalizedEnd = isBefore(parseISO(end), parseISO(start)) ? start : end;
    if (usingConvex) {
      await createTopicRangeMutation({ topicId: selectedTopic.id as Id<"topics">, startDate: start, endDate: normalizedEnd });
      setToast("Study range saved");
      return;
    }

    updateTopic(selectedCourse.id, selectedTopic.id, (topic) => ({
      ...topic,
      ranges: [...topic.ranges, { id: createId("range"), start, end: normalizedEnd }],
    }));
    setToast("Study range added");
  }

  async function savePlan(name: string, notes: string) {
    if (!activePlan) return;
    if (usingConvex) {
      await updatePlanMutation({ planId: activePlan.id as Id<"plans">, name, notes });
      setToast("Plan updated");
      return;
    }

    updatePlans((current) => current.map((plan) => (plan.id === activePlan.id ? { ...plan, name, notes } : plan)));
    setToast("Plan updated");
  }

  async function saveCourse(name: string, notes: string, color: string) {
    if (!selectedCourse) return;
    if (usingConvex) {
      await updateCourseMutation({ courseId: selectedCourse.id as Id<"courses">, name, notes, color });
      setToast("Course updated");
      return;
    }

    updateCourse(selectedCourse.id, (course) => ({ ...course, name, notes, color }));
    setToast("Course updated");
  }

  async function saveTopic(name: string, notes: string, color: string) {
    if (!selectedCourse || !selectedTopic) return;
    if (usingConvex) {
      await updateTopicMutation({ topicId: selectedTopic.id as Id<"topics">, name, notes, color });
      setToast("Topic updated");
      return;
    }

    updateTopic(selectedCourse.id, selectedTopic.id, (topic) => ({ ...topic, name, notes, color }));
    setToast("Topic updated");
  }

  async function saveMilestone(name: string, notes: string, start: string, end?: string) {
    if (!selectedCourse || !selectedMilestone) return;
    const normalizedEnd = end && isBefore(parseISO(end), parseISO(start)) ? start : end;
    if (usingConvex) {
      await updateMilestoneMutation({
        milestoneId: selectedMilestone.id as Id<"milestones">,
        name,
        notes,
        startDate: start,
        endDate: normalizedEnd,
      });
      setToast("Milestone updated");
      return;
    }

    updateCourse(selectedCourse.id, (course) => ({
      ...course,
      milestones: course.milestones.map((milestone) =>
        milestone.id === selectedMilestone.id ? { ...milestone, name, notes, start, end: normalizedEnd } : milestone,
      ),
    }));
    setToast("Milestone updated");
  }

  async function saveRange(start: string, end: string) {
    if (!selectedCourse || !selectedTopic || !selectedRange) return;
    const normalizedEnd = isBefore(parseISO(end), parseISO(start)) ? start : end;
    await updateRange(selectedCourse.id, selectedTopic.id, selectedRange.id, start, normalizedEnd);
    setEditingRangeId(null);
    setToast("Study range updated");
  }

  async function saveTopicDependencies(dependencyIds: string[]) {
    if (!selectedCourse || !selectedTopic) return;
    if (usingConvex) {
      await updateTopicDependenciesMutation({
        topicId: selectedTopic.id as Id<"topics">,
        dependencyIds: dependencyIds as Id<"topics">[],
      });
      setToast("Dependencies updated");
      return;
    }

    updateTopic(selectedCourse.id, selectedTopic.id, (topic) => ({ ...topic, dependencies: dependencyIds }));
    setToast("Dependencies updated");
  }

  async function deleteSelection() {
    if (!activePlan) return;

    if (selection.type === "plan") {
      if (usingConvex) {
        await deletePlanMutation({ planId: activePlan.id as Id<"plans"> });
      } else {
        const remainingPlans = plans.filter((plan) => plan.id !== activePlan.id);
        updatePlans(() => remainingPlans);
        const nextPlan = remainingPlans[0];
        setActivePlanId(nextPlan?.id ?? "");
        setSelection({ type: "plan", planId: nextPlan?.id ?? "" });
      }
      setToast("Plan deleted");
      return;
    }

    if (selection.type === "course" && selectedCourse) {
      if (usingConvex) {
        await deleteCourseMutation({ courseId: selectedCourse.id as Id<"courses"> });
      } else {
        updatePlans((current) =>
          current.map((plan) =>
            plan.id === activePlan.id ? { ...plan, courses: plan.courses.filter((course) => course.id !== selectedCourse.id) } : plan,
          ),
        );
      }
      setSelection({ type: "plan", planId: activePlan.id });
      setToast("Course deleted");
      return;
    }

    if (selection.type === "topic" && selectedCourse && selectedTopic) {
      if (usingConvex) {
        await deleteTopicMutation({ topicId: selectedTopic.id as Id<"topics"> });
      } else {
        updateCourse(selectedCourse.id, (course) => ({
          ...course,
          topics: course.topics
            .filter((topic) => topic.id !== selectedTopic.id)
            .map((topic) => ({ ...topic, dependencies: topic.dependencies.filter((dependencyId) => dependencyId !== selectedTopic.id) })),
        }));
      }
      setSelection({ type: "course", planId: activePlan.id, courseId: selectedCourse.id });
      setToast("Topic deleted");
      return;
    }

    if (selection.type === "milestone" && selectedCourse && selectedMilestone) {
      if (usingConvex) {
        await deleteMilestoneMutation({ milestoneId: selectedMilestone.id as Id<"milestones"> });
      } else {
        updateCourse(selectedCourse.id, (course) => ({
          ...course,
          milestones: course.milestones.filter((milestone) => milestone.id !== selectedMilestone.id),
        }));
      }
      setSelection({ type: "course", planId: activePlan.id, courseId: selectedCourse.id });
      setToast("Milestone deleted");
    }
  }

  async function deleteRange(rangeId: string, courseId = selectedCourse?.id, topicId = selectedTopic?.id) {
    if (!courseId || !topicId) return;
    if (usingConvex) {
      await deleteTopicRangeMutation({ rangeId: rangeId as Id<"topicRanges"> });
    } else {
      updateTopic(courseId, topicId, (topic) => ({
        ...topic,
        ranges: topic.ranges.filter((range) => range.id !== rangeId),
      }));
    }
    setEditingRangeId(null);
    setToast("Study range deleted");
  }

  function requestDeleteSelection() {
    const target = describeDeleteTarget(activePlan, selectedCourse, selectedTopic, selectedMilestone, selection.type);
    if (target) {
      setDeleteTarget(target);
    }
  }

  function requestDeleteRange(rangeId: string) {
    if (!selectedCourse || !selectedTopic) return;
    const range = selectedTopic.ranges.find((candidate) => candidate.id === rangeId);
    if (!range) return;

    setDeleteTarget({
      kind: "range",
      rangeId,
      courseId: selectedCourse.id,
      topicId: selectedTopic.id,
      title: "Delete study range",
      detail: `${selectedTopic.name}: ${range.start} to ${range.end}`,
    });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    try {
      if (target.kind === "selection") {
        await deleteSelection();
      } else {
        await deleteRange(target.rangeId, target.courseId, target.topicId);
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Delete failed");
    }
  }

  function updateCourse(courseId: string, updater: (course: Course) => Course) {
    updatePlans((current) =>
      current.map((plan) =>
        plan.id === activePlan?.id
          ? { ...plan, courses: plan.courses.map((course) => (course.id === courseId ? updater(course) : course)) }
          : plan,
      ),
    );
  }

  function updateTopic(courseId: string, topicId: string, updater: (topic: Topic) => Topic) {
    updateCourse(courseId, (course) => ({
      ...course,
      topics: course.topics.map((topic) => (topic.id === topicId ? updater(topic) : topic)),
    }));
  }

  async function updateRange(courseId: string, topicId: string, rangeId: string, start: string, end: string) {
    if (usingConvex) {
      await updateTopicRangeMutation({ rangeId: rangeId as Id<"topicRanges">, startDate: start, endDate: end });
      return;
    }

    updateTopic(courseId, topicId, (topic) => ({
      ...topic,
      ranges: topic.ranges.map((range) => (range.id === rangeId ? { ...range, start, end } : range)),
    }));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragState) return;
    const daysDelta = Math.round((event.clientX - dragState.originX) / dayWidth);
    const originStart = parseISO(dragState.originStart);
    const originEnd = parseISO(dragState.originEnd);
    let nextStart = originStart;
    let nextEnd = originEnd;

    if (dragState.mode === "move") {
      nextStart = addDays(originStart, daysDelta);
      nextEnd = addDays(originEnd, daysDelta);
    }

    if (dragState.mode === "start") {
      nextStart = min([addDays(originStart, daysDelta), originEnd]);
    }

    if (dragState.mode === "end") {
      nextEnd = isBefore(addDays(originEnd, daysDelta), originStart) ? originStart : addDays(originEnd, daysDelta);
    }

    void updateRange(
      dragState.courseId,
      dragState.topicId,
      dragState.rangeId,
      formatISO(nextStart, { representation: "date" }),
      formatISO(nextEnd, { representation: "date" }),
    ).catch((error) => {
      setToast(error instanceof Error ? error.message : "Range update failed");
    });
  }

  function exportPlans() {
    const blob = new Blob([JSON.stringify(serializePlans(plans), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "study-planner-export.json";
    link.click();
    URL.revokeObjectURL(url);
    setToast("Export downloaded");
  }

  async function importFile(file: File) {
    try {
      const imported = parsePlannerJson(await file.text());
      if (usingConvex) {
        const planIds = await importPlanTreesMutation({ plans: toImportPlanInputs(imported) });
        const firstPlanId = String(planIds[0] ?? "");
        if (firstPlanId) {
          setActivePlanId(firstPlanId);
          setSelection({ type: "plan", planId: firstPlanId });
        }
      } else {
        updatePlans((current) => [...current, ...imported]);
        setActivePlanId(imported[0]?.id ?? activePlanId);
      }
      setToast(`Imported ${imported.length} plan${imported.length === 1 ? "" : "s"}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Import failed");
    }
  }

  async function importGitHub(owner: string, repo: string, token: string) {
    try {
      if (usingConvex) {
        const result = await importGitHubIssuesAction({ owner, repo, token: token || undefined });
        const planId = String(result.planIds[0] ?? "");
        if (planId) {
          setActivePlanId(planId);
          setSelection({ type: "plan", planId });
        }
        setToast(`Imported ${result.issueCount} GitHub issues`);
        setModalMode(null);
        return;
      }

      const issues = await fetchGitHubIssues(owner, repo, token);
      const plan = mapGitHubIssuesToPlan(owner, repo, issues);
      updatePlans((current) => [...current, plan]);
      setActivePlanId(plan.id);
      setSelection({ type: "plan", planId: plan.id });
      setToast(`Imported ${issues.length} GitHub issues`);
      setModalMode(null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "GitHub import failed");
    }
  }

  async function previewGitHub(owner: string, repo: string, token: string) {
    if (usingConvex) {
      return await previewGitHubIssuesAction({ owner, repo, token: token || undefined });
    }

    const issues = await fetchGitHubIssues(owner, repo, token);
    return summarizeGitHubImport(owner, repo, mapGitHubIssuesToPlan(owner, repo, issues), issues.length);
  }

  const isSignedIn = signedIn || convexAuth.isAuthenticated;

  if (!isSignedIn) {
    return <LoginGate onSignIn={() => setSignedIn(true)} />;
  }

  if (usingConvex && remotePlanTrees === undefined) {
    return <LoadingPlanner />;
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--app-bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--hairline)] bg-white/82 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-[#007aff] text-white">
              <CalendarDays size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-[#1d1d1f]">Study Planner</h1>
              <p className="truncate text-xs text-[var(--muted)]">{toast}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconButton label="Import JSON" icon={<Upload size={17} />} asFile onFile={importFile} />
            <IconButton label="Export JSON" icon={<Download size={17} />} onClick={exportPlans} disabled={plans.length === 0} />
            <IconButton label="GitHub import" icon={<GitBranch size={17} />} onClick={() => setModalMode("github")} />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className="rounded-[8px] border border-[var(--hairline)] bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Plans</h2>
            <IconButton label="Add plan" icon={<Plus size={16} />} onClick={() => setModalMode("plan")} />
          </div>
          <div className="space-y-2">
            {plans.length > 0 ? (
              plans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  className={clsx(
                    "w-full rounded-[8px] border px-3 py-2 text-left transition",
                    plan.id === activePlan?.id ? "border-[#007aff] bg-[#e2f0ff]" : "border-transparent bg-[#f5f5f7] hover:bg-[#eeeeef]",
                  )}
                  onClick={() => {
                    setActivePlanId(plan.id);
                    setSelection({ type: "plan", planId: plan.id });
                  }}
                >
                  <span className="block text-sm font-medium">{plan.name}</span>
                  <span className="block text-xs text-[var(--muted)]">{plan.courses.length} courses</span>
                </button>
              ))
            ) : (
              <EmptyState title="No plans" text="Create a plan or import one to begin." icon={<CalendarDays size={18} />} />
            )}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Courses</h2>
            <IconButton label="Add course" icon={<Plus size={16} />} onClick={() => setModalMode("course")} disabled={!activePlan} />
          </div>
          <div className="mt-3 space-y-2">
            {activePlan?.courses.length ? (
              activePlan.courses.map((course) => (
                <button
                  key={course.id}
                  type="button"
                  className={clsx(
                    "flex w-full items-center gap-2 rounded-[8px] border px-3 py-2 text-left transition",
                    selection.type !== "plan" && selection.courseId === course.id
                      ? "border-[#007aff] bg-[#e2f0ff]"
                      : "border-transparent bg-[#f5f5f7] hover:bg-[#eeeeef]",
                  )}
                  onClick={() => setSelection({ type: "course", planId: activePlan.id, courseId: course.id })}
                >
                  <span className="size-3 shrink-0 rounded-full" style={{ background: course.color }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{course.name}</span>
                    <span className="block text-xs text-[var(--muted)]">{course.topics.length} topics</span>
                  </span>
                </button>
              ))
            ) : (
              <EmptyState title="No courses" text={activePlan ? "Add a course to this plan." : "Select or create a plan first."} icon={<BookOpen size={18} />} />
            )}
          </div>
        </aside>

        <section className="min-w-0 rounded-[8px] border border-[var(--hairline)] bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{activePlan?.name ?? "No plan"}</h2>
              <p className="text-sm text-[var(--muted)]">{activePlan?.notes || "Create a course and begin scheduling topics."}</p>
            </div>
            <div className="flex gap-2">
              <button className="control-button" type="button" onClick={() => setModalMode("topic")} disabled={!selectedCourse}>
                <BookOpen size={16} /> Topic
              </button>
              <button className="control-button" type="button" onClick={() => setModalMode("milestone")} disabled={!selectedCourse}>
                <Milestone size={16} /> Milestone
              </button>
              <button className="control-button" type="button" onClick={() => setModalMode("range")} disabled={!selectedTopic}>
                <GripHorizontal size={16} /> Range
              </button>
            </div>
          </div>
          <GanttChart
            plan={activePlan}
            timeline={timeline}
            selection={selection}
            setSelection={setSelection}
            dragState={dragState}
            setDragState={setDragState}
            onPointerMove={handlePointerMove}
          />
        </section>

        <Inspector
          plan={activePlan}
          selection={selection}
          onAddTopic={() => setModalMode("topic")}
          onAddMilestone={() => setModalMode("milestone")}
          onAddRange={() => setModalMode("range")}
          onEdit={(mode) => setModalMode(mode)}
          onEditDependencies={() => setModalMode("dependencies")}
          onDelete={requestDeleteSelection}
          onEditRange={(rangeId) => {
            setEditingRangeId(rangeId);
            setModalMode("edit-range");
          }}
          onDeleteRange={requestDeleteRange}
        />
      </div>

      <PlannerModal
        key={`${modalMode}:${selection.type}:${selection.planId}:${selection.type !== "plan" ? selection.courseId : ""}:${selection.type === "topic" ? selection.topicId : ""}:${selection.type === "milestone" ? selection.milestoneId : ""}:${editingRangeId ?? ""}`}
        mode={modalMode}
        plan={activePlan}
        selectedCourse={selectedCourse}
        selectedTopic={selectedTopic}
        selectedMilestone={selectedMilestone}
        selectedRange={selectedRange}
        usingConvex={usingConvex}
        onClose={() => setModalMode(null)}
        onAddPlan={addPlan}
        onAddCourse={addCourse}
        onAddTopic={addTopic}
        onAddMilestone={addMilestone}
        onAddRange={addRange}
        onSavePlan={savePlan}
        onSaveCourse={saveCourse}
        onSaveTopic={saveTopic}
        onSaveMilestone={saveMilestone}
        onSaveRange={saveRange}
        onSaveDependencies={saveTopicDependencies}
        onPreviewGitHub={previewGitHub}
        onImportGitHub={importGitHub}
      />
      <DeleteConfirmationModal
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  );
}

function LoginGate({ onSignIn }: { onSignIn: () => void }) {
  const { signIn } = useAuthActions();
  const [message, setMessage] = useState("Convex Auth is configured; local fallback remains available while OAuth credentials are added.");

  async function handleGitHubSignIn() {
    try {
      const result = await signIn("github", { redirectTo: "/" });
      if (result.redirect) {
        window.location.href = result.redirect.toString();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "OAuth is not ready yet. Using the local development gate.");
      onSignIn();
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="w-full max-w-md rounded-[8px] border border-[var(--hairline)] bg-white p-6 shadow-sm">
        <div className="mb-6 flex size-12 items-center justify-center rounded-[8px] bg-[#007aff] text-white">
          <CalendarDays size={24} />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">Study Planner</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Sign in with GitHub to manage private plans, course milestones, topic ranges, and imports.
        </p>
        <button className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-[#1d1d1f] text-sm font-medium text-white" onClick={() => void handleGitHubSignIn()}>
          <LogIn size={17} /> Continue with GitHub
        </button>
        <button className="mt-3 h-9 w-full rounded-[8px] border border-[var(--hairline)] text-xs font-medium text-[#1d1d1f]" onClick={onSignIn}>
          Use local development mode
        </button>
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{message}</p>
      </section>
    </main>
  );
}

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  asFile,
  onFile,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  asFile?: boolean;
  onFile?: (file: File) => void;
}) {
  if (asFile) {
    return (
      <label className={clsx("icon-button", disabled && "disabled")} title={label} aria-disabled={disabled}>
        {icon}
        <input
          className="sr-only"
          type="file"
          accept="application/json"
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && onFile) void onFile(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
    );
  }

  return (
    <button className="icon-button" type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {icon}
    </button>
  );
}

function EmptyState({ title, text, icon }: { title: string; text: string; icon: ReactNode }) {
  return (
    <div className="rounded-[8px] bg-[#f5f5f7] px-3 py-3 text-sm">
      <div className="mb-2 flex size-8 items-center justify-center rounded-[8px] bg-white text-[var(--muted)]">{icon}</div>
      <p className="font-medium text-[#1d1d1f]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{text}</p>
    </div>
  );
}

function GanttChart({
  plan,
  timeline,
  selection,
  setSelection,
  dragState,
  setDragState,
  onPointerMove,
}: {
  plan?: Plan;
  timeline: string[];
  selection: Selection;
  setSelection: (selection: Selection) => void;
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);

  if (!plan || plan.courses.length === 0) {
    return (
      <div className="flex min-h-[520px] items-center justify-center px-4 text-center">
        <div>
          <BookOpen className="mx-auto mb-3 text-[var(--muted)]" />
          <h3 className="font-semibold">No courses yet</h3>
          <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--muted)]">Add a course, then create topics and ranges to fill the schedule.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      className="gantt-scroll"
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragState(null)}
      onPointerCancel={() => setDragState(null)}
    >
      <div className="gantt-grid" style={{ width: 220 + timeline.length * dayWidth, "--timeline-days": timeline.length } as CSSProperties}>
        <div className="gantt-header sticky left-0 z-20 bg-white">Topic</div>
        {timeline.map((date) => (
          <div key={date} className="gantt-header text-center">
            <span>{format(parseISO(date), "MMM")}</span>
            <strong>{format(parseISO(date), "d")}</strong>
          </div>
        ))}

        {plan.courses.map((course) => (
          <CourseRows
            key={course.id}
            plan={plan}
            course={course}
            timeline={timeline}
            selection={selection}
            setSelection={setSelection}
            dragState={dragState}
            setDragState={setDragState}
          />
        ))}
      </div>
    </div>
  );
}

function CourseRows({
  plan,
  course,
  timeline,
  selection,
  setSelection,
  dragState,
  setDragState,
}: {
  plan: Plan;
  course: Course;
  timeline: string[];
  selection: Selection;
  setSelection: (selection: Selection) => void;
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;
}) {
  return (
    <>
      <button
        type="button"
        className="course-row sticky left-0 z-10"
        onClick={() => setSelection({ type: "course", planId: plan.id, courseId: course.id })}
      >
        <span className="size-3 rounded-full" style={{ background: course.color }} />
        {course.name}
      </button>
      <div className="course-band" style={{ gridColumn: `span ${timeline.length}` }}>
        {course.milestones.map((milestone) => {
          const startIndex = timeline.indexOf(milestone.start);
          if (startIndex < 0) return null;
          return (
            <button
              key={milestone.id}
              className="milestone-marker"
              style={{ left: startIndex * dayWidth + dayWidth / 2 }}
              title={milestone.name}
              onClick={() => setSelection({ type: "milestone", planId: plan.id, courseId: course.id, milestoneId: milestone.id })}
            >
              <Milestone size={13} />
            </button>
          );
        })}
      </div>

      {course.topics.map((topic) => (
        <TopicRow
          key={topic.id}
          plan={plan}
          course={course}
          topic={topic}
          timeline={timeline}
          selected={selection.type === "topic" && selection.topicId === topic.id}
          setSelection={setSelection}
          dragState={dragState}
          setDragState={setDragState}
        />
      ))}
      {course.topics.length === 0 ? (
        <>
          <div className="topic-label sticky left-0 z-10 text-[var(--muted)]">No topics</div>
          <div className="topic-track" style={{ gridColumn: `span ${timeline.length}` }} />
        </>
      ) : null}
    </>
  );
}

function TopicRow({
  plan,
  course,
  topic,
  timeline,
  selected,
  setSelection,
  dragState,
  setDragState,
}: {
  plan: Plan;
  course: Course;
  topic: Topic;
  timeline: string[];
  selected: boolean;
  setSelection: (selection: Selection) => void;
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;
}) {
  return (
    <>
      <button
        type="button"
        className={clsx("topic-label sticky left-0 z-10", selected && "selected")}
        onClick={() => setSelection({ type: "topic", planId: plan.id, courseId: course.id, topicId: topic.id })}
      >
        <span className="truncate">{topic.name}</span>
        {topic.dependencies.length > 0 ? <Link2 size={13} /> : null}
      </button>
      <div className="topic-track" style={{ gridColumn: `span ${timeline.length}` }}>
        {topic.ranges.map((range) => {
          const startOffset = differenceInCalendarDays(parseISO(range.start), parseISO(timeline[0]));
          const span = differenceInCalendarDays(parseISO(range.end), parseISO(range.start)) + 1;
          if (startOffset + span < 0 || startOffset > timeline.length) return null;
          return (
            <div
              key={range.id}
              className={clsx("range-bar", dragState?.rangeId === range.id && "dragging")}
              style={{ left: startOffset * dayWidth + 5, width: Math.max(span * dayWidth - 10, 28), background: topic.color }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setSelection({ type: "topic", planId: plan.id, courseId: course.id, topicId: topic.id });
                setDragState({
                  mode: "move",
                  planId: plan.id,
                  courseId: course.id,
                  topicId: topic.id,
                  rangeId: range.id,
                  originX: event.clientX,
                  originStart: range.start,
                  originEnd: range.end,
                });
              }}
            >
              <span
                className="range-handle left"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setDragState({
                    mode: "start",
                    planId: plan.id,
                    courseId: course.id,
                    topicId: topic.id,
                    rangeId: range.id,
                    originX: event.clientX,
                    originStart: range.start,
                    originEnd: range.end,
                  });
                }}
              />
              <span className="range-title">{format(parseISO(range.start), "MMM d")} - {format(parseISO(range.end), "MMM d")}</span>
              <span
                className="range-handle right"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setDragState({
                    mode: "end",
                    planId: plan.id,
                    courseId: course.id,
                    topicId: topic.id,
                    rangeId: range.id,
                    originX: event.clientX,
                    originStart: range.start,
                    originEnd: range.end,
                  });
                }}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

function Inspector({
  plan,
  selection,
  onAddTopic,
  onAddMilestone,
  onAddRange,
  onEdit,
  onEditDependencies,
  onDelete,
  onEditRange,
  onDeleteRange,
}: {
  plan?: Plan;
  selection: Selection;
  onAddTopic: () => void;
  onAddMilestone: () => void;
  onAddRange: () => void;
  onEdit: (mode: Exclude<ModalMode, "plan" | "course" | "topic" | "milestone" | "range" | "github" | null>) => void;
  onEditDependencies: () => void;
  onDelete: () => void;
  onEditRange: (rangeId: string) => void;
  onDeleteRange: (rangeId: string) => void;
}) {
  const course = selection.type !== "plan" ? plan?.courses.find((item) => item.id === selection.courseId) : undefined;
  const topic = selection.type === "topic" ? course?.topics.find((item) => item.id === selection.topicId) : undefined;
  const milestone = selection.type === "milestone" ? course?.milestones.find((item) => item.id === selection.milestoneId) : undefined;
  const title = topic?.name ?? milestone?.name ?? course?.name ?? plan?.name ?? "Study Planner";
  const notes = topic?.notes ?? milestone?.notes ?? course?.notes ?? plan?.notes ?? "";
  const editMode = selection.type === "plan" ? "edit-plan" : selection.type === "course" ? "edit-course" : selection.type === "topic" ? "edit-topic" : "edit-milestone";

  return (
    <aside className="rounded-[8px] border border-[var(--hairline)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold text-[var(--muted)]">
        <span className="flex items-center gap-2"><ChevronDown size={15} /> Inspector</span>
        <span className="flex items-center gap-1">
          <IconButton label="Edit selected item" icon={<Pencil size={15} />} onClick={() => onEdit(editMode)} disabled={!plan} />
          <IconButton label="Delete selected item" icon={<Trash2 size={15} />} onClick={onDelete} disabled={!plan} />
        </span>
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{notes || "No notes yet."}</p>

      {course ? (
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Metric label="Topics" value={course.topics.length} />
          <Metric label="Ranges" value={course.topics.reduce((total, item) => total + item.ranges.length, 0)} />
          <Metric label="Dates" value={course.milestones.length} />
        </div>
      ) : null}

      {topic ? (
        <div className="mt-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Dependencies</h3>
            <button className="control-button" type="button" onClick={onEditDependencies}>
              <GitBranch size={15} /> Edit
            </button>
          </div>
          <div className="space-y-1">
            {topic.dependencies.length > 0 ? (
              topic.dependencies.map((dependencyId) => {
                const dependency = course?.topics.find((candidate) => candidate.id === dependencyId);
                return (
                  <div key={dependencyId} className="rounded-[8px] bg-[#f5f5f7] px-3 py-2 text-sm">
                    {dependency?.name ?? dependencyId}
                  </div>
                );
              })
            ) : (
              <div className="rounded-[8px] bg-[#f5f5f7] px-3 py-2 text-sm text-[var(--muted)]">No dependencies</div>
            )}
          </div>
          <h3 className="text-sm font-semibold">Study ranges</h3>
          {topic.ranges.length > 0 ? (
            topic.ranges.map((range) => (
              <div key={range.id} className="flex items-center justify-between gap-2 rounded-[8px] bg-[#f5f5f7] px-3 py-2 text-sm">
                <span>{range.start} to {range.end}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <IconButton label="Edit range" icon={<Pencil size={14} />} onClick={() => onEditRange(range.id)} />
                  <IconButton label="Delete range" icon={<Trash2 size={14} />} onClick={() => onDeleteRange(range.id)} />
                </span>
              </div>
            ))
          ) : (
            <div className="rounded-[8px] bg-[#f5f5f7] px-3 py-2 text-sm text-[var(--muted)]">No study ranges</div>
          )}
        </div>
      ) : null}

      <div className="mt-5 grid gap-2">
        <button className="control-button justify-center" onClick={onAddTopic} disabled={!course}>
          <BookOpen size={16} /> Add topic
        </button>
        <button className="control-button justify-center" onClick={onAddMilestone} disabled={!course}>
          <Milestone size={16} /> Add milestone
        </button>
        <button className="control-button justify-center" onClick={onAddRange} disabled={!topic}>
          <GripHorizontal size={16} /> Add range
        </button>
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[8px] bg-[#f5f5f7] px-2 py-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
    </div>
  );
}

function LoadingPlanner() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4">
      <section className="w-full max-w-sm rounded-[8px] border border-[var(--hairline)] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-[8px] bg-[#007aff] text-white">
          <CalendarDays size={22} />
        </div>
        <h1 className="text-lg font-semibold">Loading Study Planner</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Syncing your plans from Convex.</p>
      </section>
    </main>
  );
}

function DeleteConfirmationModal({ target, onCancel, onConfirm }: { target: DeleteTarget | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <IonModal isOpen={target !== null} onDidDismiss={onCancel} className="planner-modal">
      <div className="p-5">
        <div className="mb-4 flex size-10 items-center justify-center rounded-[8px] bg-[#ffebe9] text-[#ff3b30]">
          <Trash2 size={19} />
        </div>
        <h2 className="text-xl font-semibold">{target?.title ?? "Delete item"}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{target?.detail ?? "This action cannot be undone."}</p>
        <div className="mt-6 flex justify-end gap-2">
          <IonButton fill="clear" onClick={onCancel}>Cancel</IonButton>
          <IonButton color="danger" onClick={onConfirm}>
            <Trash2 size={16} className="mr-2" /> Delete
          </IonButton>
        </div>
      </div>
    </IonModal>
  );
}

function PlannerModal({
  mode,
  plan,
  selectedCourse,
  selectedTopic,
  selectedMilestone,
  selectedRange,
  usingConvex,
  onClose,
  onAddPlan,
  onAddCourse,
  onAddTopic,
  onAddMilestone,
  onAddRange,
  onSavePlan,
  onSaveCourse,
  onSaveTopic,
  onSaveMilestone,
  onSaveRange,
  onSaveDependencies,
  onPreviewGitHub,
  onImportGitHub,
}: {
  mode: ModalMode;
  plan?: Plan;
  selectedCourse?: Course;
  selectedTopic?: Topic;
  selectedMilestone?: MilestoneType;
  selectedRange?: { id: string; start: string; end: string };
  usingConvex: boolean;
  onClose: () => void;
  onAddPlan: (name: string, notes: string) => void | Promise<void>;
  onAddCourse: (name: string, notes: string, color: string) => void | Promise<void>;
  onAddTopic: (name: string, notes: string, color: string) => void | Promise<void>;
  onAddMilestone: (name: string, notes: string, start: string, end?: string) => void | Promise<void>;
  onAddRange: (start: string, end: string) => void | Promise<void>;
  onSavePlan: (name: string, notes: string) => void | Promise<void>;
  onSaveCourse: (name: string, notes: string, color: string) => void | Promise<void>;
  onSaveTopic: (name: string, notes: string, color: string) => void | Promise<void>;
  onSaveMilestone: (name: string, notes: string, start: string, end?: string) => void | Promise<void>;
  onSaveRange: (start: string, end: string) => void | Promise<void>;
  onSaveDependencies: (dependencyIds: string[]) => void | Promise<void>;
  onPreviewGitHub: (owner: string, repo: string, token: string) => Promise<GitHubImportPreview>;
  onImportGitHub: (owner: string, repo: string, token: string) => Promise<void>;
}) {
  const fallbackEnd = formatISO(addDays(parseISO(today), 4), { representation: "date" });
  const initialName = mode === "edit-plan" ? plan?.name : mode === "edit-course" ? selectedCourse?.name : mode === "edit-topic" ? selectedTopic?.name : mode === "edit-milestone" ? selectedMilestone?.name : "";
  const initialNotes = mode === "edit-plan" ? plan?.notes : mode === "edit-course" ? selectedCourse?.notes : mode === "edit-topic" ? selectedTopic?.notes : mode === "edit-milestone" ? selectedMilestone?.notes : "";
  const initialColor = mode === "edit-course" ? selectedCourse?.color : mode === "edit-topic" ? selectedTopic?.color : selectedCourse?.color ?? applePalette[7].value;
  const initialStart = mode === "edit-milestone" ? selectedMilestone?.start : mode === "edit-range" ? selectedRange?.start : today;
  const initialEnd = mode === "edit-milestone" ? selectedMilestone?.end ?? selectedMilestone?.start : mode === "edit-range" ? selectedRange?.end : fallbackEnd;
  const [name, setName] = useState(initialName ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [color, setColor] = useState(initialColor ?? applePalette[7].value);
  const [start, setStart] = useState(initialStart ?? today);
  const [end, setEnd] = useState(initialEnd ?? fallbackEnd);
  const [owner, setOwner] = useState("erikbaender");
  const [repo, setRepo] = useState("mhh");
  const [token, setToken] = useState("");
  const [dependencyIds, setDependencyIds] = useState<string[]>(mode === "dependencies" ? selectedTopic?.dependencies ?? [] : []);
  const [githubPreview, setGitHubPreview] = useState<GitHubImportPreview | null>(null);
  const [githubError, setGitHubError] = useState("");
  const [githubBusy, setGitHubBusy] = useState(false);
  const isEditMode = mode?.startsWith("edit-") ?? false;
  const dependencyOptions = selectedCourse?.topics.filter((topic) => topic.id !== selectedTopic?.id) ?? [];

  function reset() {
    setName("");
    setNotes("");
    setColor(selectedCourse?.color ?? applePalette[7].value);
    setStart(today);
    setEnd(formatISO(addDays(parseISO(today), 4), { representation: "date" }));
  }

  function resetGitHubPreview() {
    setGitHubPreview(null);
    setGitHubError("");
  }

  async function previewGitHubImport() {
    setGitHubBusy(true);
    setGitHubError("");

    try {
      setGitHubPreview(await onPreviewGitHub(owner.trim(), repo.trim(), token.trim()));
    } catch (error) {
      setGitHubError(error instanceof Error ? error.message : "GitHub preview failed");
      setGitHubPreview(null);
    } finally {
      setGitHubBusy(false);
    }
  }

  async function submitGitHubImport() {
    setGitHubBusy(true);
    setGitHubError("");

    try {
      await onImportGitHub(owner.trim(), repo.trim(), token.trim());
    } catch (error) {
      setGitHubError(error instanceof Error ? error.message : "GitHub import failed");
    } finally {
      setGitHubBusy(false);
    }
  }

  function submit() {
    if (mode === "plan" && name.trim()) void onAddPlan(name.trim(), notes.trim());
    if (mode === "course" && name.trim()) void onAddCourse(name.trim(), notes.trim(), color);
    if (mode === "topic" && name.trim()) void onAddTopic(name.trim(), notes.trim(), color);
    if (mode === "milestone" && name.trim()) void onAddMilestone(name.trim(), notes.trim(), start, end || undefined);
    if (mode === "range") void onAddRange(start, end);
    if (mode === "edit-plan" && name.trim()) void onSavePlan(name.trim(), notes.trim());
    if (mode === "edit-course" && name.trim()) void onSaveCourse(name.trim(), notes.trim(), color);
    if (mode === "edit-topic" && name.trim()) void onSaveTopic(name.trim(), notes.trim(), color);
    if (mode === "edit-milestone" && name.trim()) void onSaveMilestone(name.trim(), notes.trim(), start, end || undefined);
    if (mode === "edit-range") void onSaveRange(start, end);
    if (mode === "dependencies") void onSaveDependencies(dependencyIds);
    reset();
    onClose();
  }

  const title = mode === "github" ? "Import GitHub issues" : mode === "dependencies" ? "Edit dependencies" : isEditMode && mode ? `Edit ${mode.replace("edit-", "")}` : `Add ${mode ?? "item"}`;

  return (
    <IonModal isOpen={mode !== null} onDidDismiss={onClose} className="planner-modal">
      <div className="p-5">
        <h2 className="text-xl font-semibold">{title}</h2>
        <div className="mt-5 grid gap-3">
          {mode === "github" ? (
            <>
              <IonInput
                label="Owner"
                labelPlacement="stacked"
                value={owner}
                onIonInput={(event) => {
                  setOwner(String(event.detail.value ?? ""));
                  resetGitHubPreview();
                }}
              />
              <IonInput
                label="Repository"
                labelPlacement="stacked"
                value={repo}
                onIonInput={(event) => {
                  setRepo(String(event.detail.value ?? ""));
                  resetGitHubPreview();
                }}
              />
              <IonInput
                label="Token"
                labelPlacement="stacked"
                type="password"
                value={token}
                onIonInput={(event) => {
                  setToken(String(event.detail.value ?? ""));
                  resetGitHubPreview();
                }}
              />
              <p className="text-xs leading-5 text-[var(--muted)]">
                {usingConvex ? "Uses the configured Convex import token when this field is empty." : "Local imports need a token pasted here."}
              </p>
              {githubError ? <div className="rounded-[8px] bg-[#ffebe9] px-3 py-2 text-sm text-[#a4261d]">{githubError}</div> : null}
              {githubPreview ? (
                <div className="rounded-[8px] bg-[#f5f5f7] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{githubPreview.planName}</p>
                      <p className="text-xs text-[var(--muted)]">{githubPreview.repository}</p>
                    </div>
                    <span className="rounded-[8px] bg-white px-2 py-1 text-xs font-semibold">{githubPreview.issueCount} issues</span>
                  </div>
                  <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
                    {githubPreview.courses.map((course) => (
                      <div key={course.name} className="rounded-[8px] bg-white px-3 py-2 text-sm">
                        <div className="truncate font-medium">{course.name}</div>
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          {course.topicCount} topics, {course.milestoneCount} milestones, {course.rangeCount} ranges
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {mode && ["plan", "course", "topic", "milestone", "edit-plan", "edit-course", "edit-topic", "edit-milestone"].includes(mode) ? (
            <>
              <IonInput label="Name" labelPlacement="stacked" value={name} onIonInput={(event) => setName(String(event.detail.value ?? ""))} />
              <IonTextarea label="Notes" labelPlacement="stacked" autoGrow value={notes} onIonInput={(event) => setNotes(String(event.detail.value ?? ""))} />
            </>
          ) : null}

          {mode && ["course", "topic", "edit-course", "edit-topic"].includes(mode) ? (
            <div>
              <p className="mb-2 text-sm font-medium">Color</p>
              <div className="grid grid-cols-7 gap-2">
                {applePalette.map((paletteColor) => (
                  <button
                    key={paletteColor.value}
                    type="button"
                    className={clsx("size-8 rounded-full border-2", color === paletteColor.value ? "border-[#1d1d1f]" : "border-transparent")}
                    title={paletteColor.name}
                    style={{ background: paletteColor.value }}
                    onClick={() => setColor(paletteColor.value)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {mode && ["milestone", "range", "edit-milestone", "edit-range"].includes(mode) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <IonInput label="Start" labelPlacement="stacked" type="date" value={start} onIonInput={(event) => setStart(String(event.detail.value ?? today))} />
              <IonInput label="End" labelPlacement="stacked" type="date" value={end} onIonInput={(event) => setEnd(String(event.detail.value ?? start))} />
            </div>
          ) : null}

          {mode === "dependencies" ? (
            <div className="grid gap-2">
              {dependencyOptions.length > 0 ? (
                dependencyOptions.map((topic) => (
                  <label key={topic.id} className="flex items-center justify-between gap-3 rounded-[8px] bg-[#f5f5f7] px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{topic.name}</span>
                    <input
                      type="checkbox"
                      checked={dependencyIds.includes(topic.id)}
                      onChange={(event) => {
                        setDependencyIds((current) =>
                          event.currentTarget.checked ? [...current, topic.id] : current.filter((dependencyId) => dependencyId !== topic.id),
                        );
                      }}
                    />
                  </label>
                ))
              ) : (
                <div className="rounded-[8px] bg-[#f5f5f7] px-3 py-2 text-sm text-[var(--muted)]">No other topics in this course</div>
              )}
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <IonButton fill="clear" onClick={onClose}>Cancel</IonButton>
          {mode === "github" ? (
            <>
              <IonButton fill="outline" onClick={() => void previewGitHubImport()} disabled={githubBusy || !owner || !repo || (!usingConvex && !token)}>
                <GitBranch size={16} className="mr-2" /> Preview
              </IonButton>
              <IonButton onClick={() => void submitGitHubImport()} disabled={githubBusy || !githubPreview}>
                <GitBranch size={16} className="mr-2" /> Import
              </IonButton>
            </>
          ) : (
            <IonButton onClick={submit} disabled={!mode?.includes("range") && mode !== "dependencies" && !name.trim()}>
              <Save size={16} className="mr-2" /> Save
            </IonButton>
          )}
        </div>
      </div>
    </IonModal>
  );
}

function describeDeleteTarget(
  plan: Plan | undefined,
  course: Course | undefined,
  topic: Topic | undefined,
  milestone: MilestoneType | undefined,
  selectionType: Selection["type"],
): DeleteTarget | null {
  if (selectionType === "plan" && plan) {
    const courseText = `${plan.courses.length} course${plan.courses.length === 1 ? "" : "s"}`;
    return { kind: "selection", title: "Delete plan", detail: `${plan.name} and its ${courseText} will be removed.` };
  }

  if (selectionType === "course" && course) {
    const topicText = `${course.topics.length} topic${course.topics.length === 1 ? "" : "s"}`;
    const milestoneText = `${course.milestones.length} milestone${course.milestones.length === 1 ? "" : "s"}`;
    return { kind: "selection", title: "Delete course", detail: `${course.name} with ${topicText} and ${milestoneText} will be removed.` };
  }

  if (selectionType === "topic" && topic) {
    const rangeText = `${topic.ranges.length} range${topic.ranges.length === 1 ? "" : "s"}`;
    return { kind: "selection", title: "Delete topic", detail: `${topic.name} and its ${rangeText} will be removed.` };
  }

  if (selectionType === "milestone" && milestone) {
    return { kind: "selection", title: "Delete milestone", detail: `${milestone.name} on ${milestone.start} will be removed.` };
  }

  return null;
}

function summarizeGitHubImport(owner: string, repo: string, plan: Plan, issueCount: number): GitHubImportPreview {
  return {
    issueCount,
    planName: plan.name,
    repository: `${owner}/${repo}`,
    courses: plan.courses.map((course) => ({
      name: course.name,
      topicCount: course.topics.length,
      milestoneCount: course.milestones.length,
      rangeCount: course.topics.reduce((total, topic) => total + topic.ranges.length, 0),
    })),
  };
}

function buildTimeline(plan?: Plan) {
  const dates: string[] = [];
  const allDates = plan?.courses.flatMap((course) => [
    ...course.milestones.flatMap((milestone) => [milestone.start, milestone.end].filter(Boolean) as string[]),
    ...course.topics.flatMap((topic) => topic.ranges.flatMap((range) => [range.start, range.end])),
  ]) ?? [today];
  const start = min(allDates.map((date) => parseISO(date)));
  const end = allDates.map((date) => parseISO(date)).sort((left, right) => right.getTime() - left.getTime())[0];
  const paddedStart = addDays(start, -3);
  const paddedEnd = addDays(end, 10);
  const dayCount = Math.max(differenceInCalendarDays(paddedEnd, paddedStart), 35);

  for (let offset = 0; offset <= dayCount; offset += 1) {
    dates.push(formatISO(addDays(paddedStart, offset), { representation: "date" }));
  }

  return dates;
}

type ConvexPlanTree = {
  _id: string;
  name: string;
  notes: string;
  courses: Array<{
    _id: string;
    planId: string;
    name: string;
    notes: string;
    color: string;
    milestones: Array<{
      _id: string;
      courseId: string;
      name: string;
      notes: string;
      startDate: string;
      endDate?: string;
    }>;
    topics: Array<{
      _id: string;
      courseId: string;
      name: string;
      notes: string;
      color: string;
      dependencyIds: string[];
      ranges: Array<{
        _id: string;
        topicId: string;
        startDate: string;
        endDate: string;
      }>;
    }>;
  }>;
};

function mapConvexPlanTrees(planTrees: ConvexPlanTree[]): Plan[] {
  return planTrees.map((plan) => ({
    id: plan._id,
    name: plan.name,
    notes: plan.notes,
    courses: plan.courses.map((course) => ({
      id: course._id,
      planId: course.planId,
      name: course.name,
      notes: course.notes,
      color: course.color,
      milestones: course.milestones.map((milestone) => ({
        id: milestone._id,
        courseId: milestone.courseId,
        name: milestone.name,
        notes: milestone.notes,
        start: milestone.startDate,
        end: milestone.endDate,
      })),
      topics: course.topics.map((topic) => ({
        id: topic._id,
        courseId: topic.courseId,
        name: topic.name,
        notes: topic.notes,
        color: topic.color,
        dependencies: topic.dependencyIds,
        ranges: topic.ranges.map((range) => ({
          id: range._id,
          start: range.startDate,
          end: range.endDate,
        })),
      })),
    })),
  }));
}

function toImportPlanInputs(plans: Plan[]) {
  return plans.map((plan) => ({
    name: plan.name,
    notes: plan.notes,
    courses: plan.courses.map((course) => {
      const topicNamesById = new Map(course.topics.map((topic) => [topic.id, topic.name]));

      return {
        name: course.name,
        notes: course.notes,
        color: course.color,
        milestones: course.milestones.map((milestone) => ({
          name: milestone.name,
          notes: milestone.notes,
          start: milestone.start,
          end: milestone.end,
        })),
        topics: course.topics.map((topic) => ({
          name: topic.name,
          notes: topic.notes,
          color: topic.color,
          dependencies: topic.dependencies.map((dependency) => topicNamesById.get(dependency) ?? dependency),
          ranges: topic.ranges.map((range) => ({ start: range.start, end: range.end })),
        })),
      };
    }),
  }));
}