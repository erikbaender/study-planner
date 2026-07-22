"use client";

import { addDays, differenceInCalendarDays, format, formatISO, isBefore, min, parseISO } from "date-fns";
import {
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Download,
  GraduationCap,
  Link2,
  LogIn,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { setupIonicReact } from "@ionic/react";
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
import { filterImportableGitHubIssues, fetchGitHubIssues, mapGitHubIssuesToPlan, parsePlannerJson, serializePlans } from "@/lib/import-export";
import { Button, Dialog, FileIconButton, IconButton, TextArea, TextField } from "@/components/ui";

setupIonicReact({ mode: "ios" });

type Selection =
  | { type: "plan"; planId: string }
  | { type: "course"; planId: string; courseId: string }
  | { type: "topic"; planId: string; courseId: string; topicId: string }
  | { type: "milestone"; planId: string; courseId: string; milestoneId: string };

type DragState = {
  kind: "milestone" | "range";
  mode: "move" | "start" | "end";
  planId: string;
  courseId: string;
  topicId?: string;
  itemId: string;
  originX: number;
  originStart: string;
  originEnd: string;
  currentStart: string;
  currentEnd: string;
};

type CreationGesture = {
  courseId: string;
  topicId?: string;
  trackLeft: number;
  originIndex: number;
  currentIndex: number;
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
  skippedSubissueCount?: number;
  planName: string;
  repository: string;
  courses: Array<{ name: string; topicCount: number; milestoneCount: number; rangeCount: number }>;
};

type DeleteTarget =
  | { kind: "selection"; title: string; detail: string }
  | { kind: "range"; rangeId: string; courseId: string; topicId: string; title: string; detail: string };

const dayWidth = 42;
const today = "2026-05-01";
const themeStorageKey = "study-planner-theme";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const storedTheme = window.localStorage.getItem(themeStorageKey);
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return "dark";
}

export function StudyPlannerApp() {
  const [signedIn, setSignedIn] = useState(false);
  const [localPlans, setLocalPlans] = useState<Plan[]>(samplePlans);
  const [activePlanId, setActivePlanId] = useState(samplePlans[0]?.id ?? "");
  const [selection, setSelection] = useState<Selection>({ type: "plan", planId: samplePlans[0]?.id ?? "" });
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingRangeId, setEditingRangeId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [creationGesture, setCreationGesture] = useState<CreationGesture | null>(null);
  const [collapsedCourseIds, setCollapsedCourseIds] = useState<Set<string>>(() => new Set());
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [toast, setToast] = useState("Ready");

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
    window.localStorage.setItem(themeStorageKey, theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

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

  async function updateMilestoneDates(courseId: string, milestoneId: string, start: string, end: string) {
    const milestone = activePlan?.courses.find((course) => course.id === courseId)?.milestones.find((candidate) => candidate.id === milestoneId);
    if (!milestone) return;
    if (usingConvex) {
      await updateMilestoneMutation({
        milestoneId: milestoneId as Id<"milestones">,
        name: milestone.name,
        notes: milestone.notes,
        startDate: start,
        endDate: end,
      });
      return;
    }

    updateCourse(courseId, (course) => ({
      ...course,
      milestones: course.milestones.map((candidate) => candidate.id === milestoneId ? { ...candidate, start, end } : candidate),
    }));
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (creationGesture) {
      const pointerIndex = Math.max(0, Math.min(timeline.length - 1, Math.floor((event.clientX - creationGesture.trackLeft) / dayWidth)));
      const course = activePlan?.courses.find((candidate) => candidate.id === creationGesture.courseId);
      const topic = creationGesture.topicId ? course?.topics.find((candidate) => candidate.id === creationGesture.topicId) : undefined;
      const occupiedRanges = topic?.ranges ?? course?.milestones.map((milestone) => ({
        start: milestone.start,
        end: milestone.end ?? milestone.start,
      })) ?? [];
      const currentIndex = clampCreationIndex(creationGesture.originIndex, pointerIndex, timeline, occupiedRanges);
      if (currentIndex !== creationGesture.currentIndex) {
        setCreationGesture({ ...creationGesture, currentIndex });
      }
      return;
    }

    if (!dragState) return;
    const daysDelta = Math.round((event.clientX - dragState.originX) / dayWidth);
    const originStart = parseISO(dragState.originStart);
    const originEnd = parseISO(dragState.originEnd);
    const course = activePlan?.courses.find((candidate) => candidate.id === dragState.courseId);
    const topic = dragState.topicId ? course?.topics.find((candidate) => candidate.id === dragState.topicId) : undefined;
    const neighboringRanges = dragState.kind === "range"
      ? topic?.ranges.filter((range) => range.id !== dragState.itemId) ?? []
      : course?.milestones.filter((milestone) => milestone.id !== dragState.itemId).map((milestone) => ({
          start: milestone.start,
          end: milestone.end ?? milestone.start,
        })) ?? [];
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

    const constrained = constrainRangeToNeighbors(
      dragState.mode,
      originStart,
      originEnd,
      nextStart,
      nextEnd,
      neighboringRanges,
    );
    nextStart = constrained.start;
    nextEnd = constrained.end;

    const currentStart = formatISO(nextStart, { representation: "date" });
    const currentEnd = formatISO(nextEnd, { representation: "date" });
    if (currentStart !== dragState.currentStart || currentEnd !== dragState.currentEnd) {
      setDragState({ ...dragState, currentStart, currentEnd });
    }
  }

  function handlePointerEnd() {
    if (creationGesture && activePlan) {
      const gesture = creationGesture;
      setCreationGesture(null);
      const startIndex = Math.min(gesture.originIndex, gesture.currentIndex);
      const endIndex = Math.max(gesture.originIndex, gesture.currentIndex);
      const start = timeline[startIndex];
      const end = timeline[endIndex];
      const course = activePlan.courses.find((candidate) => candidate.id === gesture.courseId);
      if (!course || !start || !end) return;

      if (gesture.topicId) {
        const topic = course.topics.find((candidate) => candidate.id === gesture.topicId);
        if (!topic) return;
        setSelection({ type: "topic", planId: activePlan.id, courseId: course.id, topicId: topic.id });
        void createRangeForTopic(course.id, topic.id, start, end).catch((error) => {
          setToast(error instanceof Error ? error.message : "Range creation failed");
        });
        return;
      }

      setSelection({ type: "course", planId: activePlan.id, courseId: course.id });
      void createMilestoneForCourse(course, start, end).catch((error) => {
        setToast(error instanceof Error ? error.message : "Milestone creation failed");
      });
      return;
    }

    if (!dragState) return;
    const item = dragState;
    setDragState(null);
    const update = item.kind === "range" && item.topicId
      ? updateRange(item.courseId, item.topicId, item.itemId, item.currentStart, item.currentEnd)
      : updateMilestoneDates(item.courseId, item.itemId, item.currentStart, item.currentEnd);
    void update.catch((error) => {
      setToast(error instanceof Error ? error.message : `${item.kind === "range" ? "Range" : "Milestone"} update failed`);
    });
  }

  async function createMilestoneForCourse(course: Course, start: string, end: string) {
    if (!activePlan) return;
    if (course.milestones.some((milestone) => dateRangesOverlap(start, end, milestone.start, milestone.end ?? milestone.start))) {
      setToast("Milestones cannot overlap");
      return;
    }

    if (usingConvex) {
      const milestoneId = String(await createMilestoneMutation({
        courseId: course.id as Id<"courses">,
        name: course.name,
        notes: "",
        startDate: start,
        endDate: end,
      }));
      setSelection({ type: "milestone", planId: activePlan.id, courseId: course.id, milestoneId });
      setToast("Milestone created");
      return;
    }

    const milestone: MilestoneType = { id: createId("milestone"), courseId: course.id, name: course.name, notes: "", start, end };
    updateCourse(course.id, (current) => ({ ...current, milestones: [...current.milestones, milestone] }));
    setSelection({ type: "milestone", planId: activePlan.id, courseId: course.id, milestoneId: milestone.id });
    setToast("Milestone created");
  }

  async function createRangeForTopic(courseId: string, topicId: string, start: string, end: string) {
    const topic = activePlan?.courses.find((course) => course.id === courseId)?.topics.find((candidate) => candidate.id === topicId);
    if (!topic || topic.ranges.some((range) => dateRangesOverlap(start, end, range.start, range.end))) {
      setToast("Study ranges cannot overlap");
      return;
    }

    if (usingConvex) {
      await createTopicRangeMutation({ topicId: topicId as Id<"topics">, startDate: start, endDate: end });
      setToast("Study range created");
      return;
    }

    updateTopic(courseId, topicId, (topic) => ({
      ...topic,
      ranges: [...topic.ranges, { id: createId("range"), start, end }],
    }));
    setToast("Study range created");
  }

  function toggleCourse(courseId: string) {
    setCollapsedCourseIds((current) => {
      const next = new Set(current);
      if (next.has(courseId)) {
        next.delete(courseId);
      } else {
        next.add(courseId);
      }
      return next;
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
        setToast(formatGitHubImportToast(result.issueCount, result.skippedSubissueCount));
        setModalMode(null);
        return;
      }

      const rawIssues = await fetchGitHubIssues(owner, repo, token);
      const { issues, skippedSubissueCount } = filterImportableGitHubIssues(rawIssues);
      const plan = mapGitHubIssuesToPlan(owner, repo, issues);
      updatePlans((current) => [...current, plan]);
      setActivePlanId(plan.id);
      setSelection({ type: "plan", planId: plan.id });
      setToast(formatGitHubImportToast(issues.length, skippedSubissueCount));
      setModalMode(null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "GitHub import failed");
    }
  }

  async function previewGitHub(owner: string, repo: string, token: string) {
    if (usingConvex) {
      return await previewGitHubIssuesAction({ owner, repo, token: token || undefined });
    }

    const rawIssues = await fetchGitHubIssues(owner, repo, token);
    const { issues, skippedSubissueCount } = filterImportableGitHubIssues(rawIssues);
    return summarizeGitHubImport(owner, repo, mapGitHubIssuesToPlan(owner, repo, issues), issues.length, skippedSubissueCount);
  }

  const isSignedIn = signedIn || convexAuth.isAuthenticated;

  if (!isSignedIn) {
    return <LoginGate onSignIn={() => setSignedIn(true)} />;
  }

  if (usingConvex && remotePlanTrees === undefined) {
    return <LoadingPlanner />;
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="flex min-w-0 items-center gap-3">
            <div className="app-mark">
              <CalendarDays size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">Study Planner</h1>
              <p className="app-status">{toast}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <IconButton
              label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              icon={theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            />
            <FileIconButton label="Import JSON" icon={<Upload size={17} />} accept="application/json" onFile={(file) => void importFile(file)} />
            <IconButton label="Export JSON" icon={<Download size={17} />} onClick={exportPlans} disabled={plans.length === 0} />
            <IconButton label="GitHub import" icon={<GitBranch size={17} />} onClick={() => setModalMode("github")} />
          </div>
        </div>
      </header>

      <div
        className={clsx(
          "planner-layout mx-auto grid w-full max-w-[1600px] flex-1 overflow-hidden p-4",
          leftPaneCollapsed && "left-collapsed",
          rightPaneCollapsed && "right-collapsed",
        )}
      >
        {!leftPaneCollapsed ? (
        <aside className="planner-pane ui-panel navigation-panel p-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Plans</h2>
            <span className="flex items-center gap-1">
              <IconButton label="Collapse navigation" icon={<ChevronLeft size={16} />} onClick={() => setLeftPaneCollapsed(true)} />
              <IconButton label="Add plan" icon={<Plus size={16} />} onClick={() => setModalMode("plan")} />
            </span>
          </div>
          <div className="space-y-2">
            {plans.length > 0 ? (
              plans.map((plan) => (
                <Button
                  key={plan.id}
                  variant="unstyled"
                  className={clsx(
                    "nav-row",
                    plan.id === activePlan?.id && "selected",
                  )}
                  onClick={() => {
                    setActivePlanId(plan.id);
                    setSelection({ type: "plan", planId: plan.id });
                  }}
                >
                  <span className="block text-sm font-medium">{plan.name}</span>
                  <span className="block text-xs text-[var(--muted)]">{plan.courses.length} courses</span>
                </Button>
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
                <Button
                  key={course.id}
                  variant="unstyled"
                  className={clsx(
                    "nav-row flex items-center gap-2",
                    selection.type !== "plan" && selection.courseId === course.id && "selected",
                  )}
                  onClick={() => setSelection({ type: "course", planId: activePlan.id, courseId: course.id })}
                >
                  <span className="size-3 shrink-0 rounded-full" style={{ background: course.color }} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{course.name}</span>
                    <span className="block text-xs text-[var(--muted)]">{course.topics.length} topics</span>
                  </span>
                </Button>
              ))
            ) : (
              <EmptyState title="No courses" text={activePlan ? "Add a course to this plan." : "Select or create a plan first."} icon={<GraduationCap size={18} />} />
            )}
          </div>
        </aside>
        ) : null}

        <section className="planner-main ui-panel min-w-0">
          <div className="planner-toolbar">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{activePlan?.name ?? "No plan"}</h2>
              <p className="text-sm text-[var(--muted)]">{activePlan?.notes || "Create a course and begin scheduling topics."}</p>
            </div>
            <div className="flex gap-2">
              {leftPaneCollapsed ? <IconButton label="Show navigation" icon={<ChevronRight size={16} />} onClick={() => setLeftPaneCollapsed(false)} /> : null}
              {rightPaneCollapsed ? <IconButton label="Show inspector" icon={<ChevronLeft size={16} />} onClick={() => setRightPaneCollapsed(false)} /> : null}
              <Button leadingIcon={<BookOpen size={16} />} onClick={() => setModalMode("topic")} disabled={!selectedCourse}>Topic</Button>
            </div>
          </div>
          <GanttChart
            plan={activePlan}
            timeline={timeline}
            selection={selection}
            setSelection={setSelection}
            dragState={dragState}
            setDragState={setDragState}
            creationGesture={creationGesture}
            setCreationGesture={setCreationGesture}
            onPointerMove={handlePointerMove}
            onPointerEnd={handlePointerEnd}
            collapsedCourseIds={collapsedCourseIds}
            onToggleCourse={toggleCourse}
          />
        </section>

        {!rightPaneCollapsed ? (
        <div className="planner-pane min-w-0">
          <div className="mb-2 flex justify-end">
            <IconButton label="Collapse inspector" icon={<ChevronRight size={16} />} onClick={() => setRightPaneCollapsed(true)} />
          </div>
        <Inspector
          plan={activePlan}
          selection={selection}
          onAddTopic={() => setModalMode("topic")}
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
        ) : null}
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
      <section className="auth-panel ui-panel w-full max-w-md p-6">
        <div className="app-mark mb-6">
          <CalendarDays size={24} />
        </div>
        <h1 className="text-2xl font-semibold tracking-normal">Study Planner</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Sign in with GitHub to manage private plans, course milestones, topic ranges, and imports.
        </p>
        <Button className="mt-6 w-full" variant="primary" leadingIcon={<LogIn size={16} />} onClick={() => void handleGitHubSignIn()}>
          Continue with GitHub
        </Button>
        <Button className="mt-3 w-full" onClick={onSignIn}>
          Use local development mode
        </Button>
        <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{message}</p>
      </section>
    </main>
  );
}

function EmptyState({ title, text, icon }: { title: string; text: string; icon: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <p className="font-medium">{title}</p>
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
  creationGesture,
  setCreationGesture,
  onPointerMove,
  onPointerEnd,
  collapsedCourseIds,
  onToggleCourse,
}: {
  plan?: Plan;
  timeline: string[];
  selection: Selection;
  setSelection: (selection: Selection) => void;
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;
  creationGesture: CreationGesture | null;
  setCreationGesture: (state: CreationGesture | null) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerEnd: () => void;
  collapsedCourseIds: Set<string>;
  onToggleCourse: (courseId: string) => void;
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
      onPointerUp={onPointerEnd}
      onPointerCancel={() => {
        setDragState(null);
        setCreationGesture(null);
      }}
    >
      <div className="gantt-grid" style={{ width: 220 + timeline.length * dayWidth, "--timeline-days": timeline.length } as CSSProperties}>
        <div className="gantt-header sticky left-0 z-20">Topic</div>
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
            creationGesture={creationGesture}
            setCreationGesture={setCreationGesture}
            collapsed={collapsedCourseIds.has(course.id)}
            onToggleCourse={onToggleCourse}
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
  creationGesture,
  setCreationGesture,
  collapsed,
  onToggleCourse,
}: {
  plan: Plan;
  course: Course;
  timeline: string[];
  selection: Selection;
  setSelection: (selection: Selection) => void;
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;
  creationGesture: CreationGesture | null;
  setCreationGesture: (state: CreationGesture | null) => void;
  collapsed: boolean;
  onToggleCourse: (courseId: string) => void;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  return (
    <>
      <Button
        variant="unstyled"
        className="course-row sticky left-0 z-10"
        aria-expanded={!collapsed}
        onClick={() => {
          setSelection({ type: "course", planId: plan.id, courseId: course.id });
          onToggleCourse(course.id);
        }}
      >
        <ChevronDown className={clsx("course-toggle", collapsed && "collapsed")} size={15} />
        <span className="size-3 shrink-0 rounded-full" style={{ background: course.color }} />
        <span className="truncate">{course.name}</span>
      </Button>
      <div
        className="course-band gantt-create-target"
        style={{ gridColumn: `span ${timeline.length}` }}
        onPointerDown={(event) => startCreationGesture(event, course.id, undefined, timeline, setCreationGesture)}
        onPointerMove={(event) => setHoverIndex(event.target === event.currentTarget ? pointerDayIndex(event, timeline.length) : null)}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {creationGesture?.courseId === course.id && creationGesture.topicId === undefined ? (
          <CreationPreview startIndex={creationGesture.originIndex} endIndex={creationGesture.currentIndex} color={course.color} />
        ) : hoverIndex !== null && creationGesture === null ? (
          <CreationPreview startIndex={hoverIndex} endIndex={hoverIndex} color={course.color} hover />
        ) : null}
        {course.milestones.map((milestone) => {
          const visibleMilestone = dragState?.kind === "milestone" && dragState.itemId === milestone.id
            ? { start: dragState.currentStart, end: dragState.currentEnd }
            : { start: milestone.start, end: milestone.end ?? milestone.start };
          const startOffset = differenceInCalendarDays(parseISO(visibleMilestone.start), parseISO(timeline[0]));
          const span = differenceInCalendarDays(parseISO(visibleMilestone.end), parseISO(visibleMilestone.start)) + 1;
          if (startOffset + span < 0 || startOffset > timeline.length) return null;
          return (
            <GanttBar
              key={milestone.id}
              label={milestone.name}
              color={course.color}
              startIndex={startOffset}
              endIndex={startOffset + span - 1}
              dragging={dragState?.kind === "milestone" && dragState.itemId === milestone.id}
              title={milestone.name}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setSelection({ type: "milestone", planId: plan.id, courseId: course.id, milestoneId: milestone.id });
                setDragState({
                  kind: "milestone",
                  mode: "move",
                  planId: plan.id,
                  courseId: course.id,
                  itemId: milestone.id,
                  originX: event.clientX,
                  originStart: milestone.start,
                  originEnd: milestone.end ?? milestone.start,
                  currentStart: milestone.start,
                  currentEnd: milestone.end ?? milestone.start,
                });
              }}
              onClick={() => setSelection({ type: "milestone", planId: plan.id, courseId: course.id, milestoneId: milestone.id })}
            >
              <GanttResizeHandle
                side="left"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragState({
                    kind: "milestone",
                    mode: "start",
                    planId: plan.id,
                    courseId: course.id,
                    itemId: milestone.id,
                    originX: event.clientX,
                    originStart: milestone.start,
                    originEnd: milestone.end ?? milestone.start,
                    currentStart: milestone.start,
                    currentEnd: milestone.end ?? milestone.start,
                  });
                }}
              />
              <GanttResizeHandle
                side="right"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragState({
                    kind: "milestone",
                    mode: "end",
                    planId: plan.id,
                    courseId: course.id,
                    itemId: milestone.id,
                    originX: event.clientX,
                    originStart: milestone.start,
                    originEnd: milestone.end ?? milestone.start,
                    currentStart: milestone.start,
                    currentEnd: milestone.end ?? milestone.start,
                  });
                }}
              />
            </GanttBar>
          );
        })}
      </div>

      {!collapsed && course.topics.map((topic) => (
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
          creationGesture={creationGesture}
          setCreationGesture={setCreationGesture}
        />
      ))}
      {!collapsed && course.topics.length === 0 ? (
        <>
          <div className="topic-label sticky left-0 z-10 text-[var(--muted)]">No topics</div>
          <div className="topic-track" style={{ gridColumn: `span ${timeline.length}` }} />
        </>
      ) : null}
    </>
  );
}

function startCreationGesture(
  event: PointerEvent<HTMLDivElement>,
  courseId: string,
  topicId: string | undefined,
  timeline: string[],
  setCreationGesture: (state: CreationGesture | null) => void,
) {
  if (event.button !== 0) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const originIndex = Math.max(0, Math.min(timeline.length - 1, Math.floor((event.clientX - bounds.left) / dayWidth)));
  event.currentTarget.setPointerCapture(event.pointerId);
  setCreationGesture({ courseId, topicId, trackLeft: bounds.left, originIndex, currentIndex: originIndex });
}

function pointerDayIndex(event: PointerEvent<HTMLDivElement>, timelineLength: number) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return Math.max(0, Math.min(timelineLength - 1, Math.floor((event.clientX - bounds.left) / dayWidth)));
}

function dateRangesOverlap(start: string, end: string, otherStart: string, otherEnd: string) {
  return start <= otherEnd && end >= otherStart;
}

function clampCreationIndex(originIndex: number, pointerIndex: number, timeline: string[], ranges: Array<{ start: string; end: string }>) {
  if (pointerIndex === originIndex) return pointerIndex;
  const originDate = timeline[originIndex];
  const pointerDate = timeline[pointerIndex];

  if (pointerIndex > originIndex) {
    const blocker = ranges
      .filter((range) => range.end >= originDate && range.start <= pointerDate)
      .sort((left, right) => left.start.localeCompare(right.start))[0];
    if (!blocker) return pointerIndex;
    const blockerIndex = differenceInCalendarDays(parseISO(blocker.start), parseISO(timeline[0]));
    return Math.max(originIndex, blockerIndex - 1);
  }

  const blocker = ranges
    .filter((range) => range.start <= originDate && range.end >= pointerDate)
    .sort((left, right) => right.end.localeCompare(left.end))[0];
  if (!blocker) return pointerIndex;
  const blockerIndex = differenceInCalendarDays(parseISO(blocker.end), parseISO(timeline[0]));
  return Math.min(originIndex, blockerIndex + 1);
}

function constrainRangeToNeighbors(
  mode: DragState["mode"],
  originStart: Date,
  originEnd: Date,
  candidateStart: Date,
  candidateEnd: Date,
  ranges: Array<{ start: string; end: string }>,
) {
  const previousEnd = ranges
    .map((range) => parseISO(range.end))
    .filter((end) => isBefore(end, originStart))
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const nextStart = ranges
    .map((range) => parseISO(range.start))
    .filter((start) => isBefore(originEnd, start))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const earliestStart = previousEnd ? addDays(previousEnd, 1) : candidateStart;
  const latestEnd = nextStart ? addDays(nextStart, -1) : candidateEnd;

  if (mode === "start") {
    return { start: isBefore(candidateStart, earliestStart) ? earliestStart : candidateStart, end: candidateEnd };
  }

  if (mode === "end") {
    return { start: candidateStart, end: isBefore(latestEnd, candidateEnd) ? latestEnd : candidateEnd };
  }

  const duration = differenceInCalendarDays(originEnd, originStart);
  let start = candidateStart;
  if (previousEnd && isBefore(start, earliestStart)) start = earliestStart;
  if (nextStart) {
    const latestStart = addDays(latestEnd, -duration);
    if (isBefore(latestStart, start)) start = latestStart;
  }
  return { start, end: addDays(start, duration) };
}

function CreationPreview({ startIndex, endIndex, color, hover = false }: { startIndex: number; endIndex: number; color: string; hover?: boolean }) {
  const normalizedStart = Math.min(startIndex, endIndex);
  const normalizedEnd = Math.max(startIndex, endIndex);
  return (
    <div
      className={clsx("gantt-creation-preview", hover && "hover")}
      style={{
        left: normalizedStart * dayWidth + 6,
        width: (normalizedEnd - normalizedStart + 1) * dayWidth - 12,
        "--preview-color": color,
      } as CSSProperties}
    />
  );
}

function GanttBar({ label, color, startIndex, endIndex, title, onPointerDown, onClick, children, dragging = false }: {
  label: string;
  color: string;
  startIndex: number;
  endIndex: number;
  title: string;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
  children?: ReactNode;
  dragging?: boolean;
}) {
  const span = Math.max(endIndex - startIndex + 1, 1);
  return (
    <div
      className={clsx("range-bar", dragging && "dragging")}
      style={{ left: startIndex * dayWidth + 6, width: Math.max(span * dayWidth - 12, 30), background: color }}
      title={title}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {children}
      <span className="range-title">{label}</span>
    </div>
  );
}

function GanttResizeHandle({ side, onPointerDown }: { side: "left" | "right"; onPointerDown: (event: PointerEvent<HTMLSpanElement>) => void }) {
  return <span className={`range-handle ${side}`} onPointerDown={onPointerDown} />;
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
  creationGesture,
  setCreationGesture,
}: {
  plan: Plan;
  course: Course;
  topic: Topic;
  timeline: string[];
  selected: boolean;
  setSelection: (selection: Selection) => void;
  dragState: DragState | null;
  setDragState: (state: DragState | null) => void;
  creationGesture: CreationGesture | null;
  setCreationGesture: (state: CreationGesture | null) => void;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  return (
    <>
      <Button
        variant="unstyled"
        className={clsx("topic-label sticky left-0 z-10", selected && "selected")}
        onClick={() => setSelection({ type: "topic", planId: plan.id, courseId: course.id, topicId: topic.id })}
      >
        <span className="truncate">{topic.name}</span>
        {topic.dependencies.length > 0 ? <Link2 size={13} /> : null}
      </Button>
      <div
        className="topic-track gantt-create-target"
        style={{ gridColumn: `span ${timeline.length}` }}
        onPointerDown={(event) => startCreationGesture(event, course.id, topic.id, timeline, setCreationGesture)}
        onPointerMove={(event) => setHoverIndex(event.target === event.currentTarget ? pointerDayIndex(event, timeline.length) : null)}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {creationGesture?.courseId === course.id && creationGesture.topicId === topic.id ? (
          <CreationPreview startIndex={creationGesture.originIndex} endIndex={creationGesture.currentIndex} color={course.color} />
        ) : hoverIndex !== null && creationGesture === null ? (
          <CreationPreview startIndex={hoverIndex} endIndex={hoverIndex} color={course.color} hover />
        ) : null}
        {topic.ranges.map((range) => {
          const visibleRange = dragState?.kind === "range" && dragState.itemId === range.id ? { start: dragState.currentStart, end: dragState.currentEnd } : range;
          const startOffset = differenceInCalendarDays(parseISO(visibleRange.start), parseISO(timeline[0]));
          const span = differenceInCalendarDays(parseISO(visibleRange.end), parseISO(visibleRange.start)) + 1;
          if (startOffset + span < 0 || startOffset > timeline.length) return null;
          return (
            <GanttBar
              key={range.id}
              label={topic.name}
              color={course.color}
              startIndex={startOffset}
              endIndex={startOffset + span - 1}
              dragging={dragState?.kind === "range" && dragState.itemId === range.id}
              title={`${course.name}: ${topic.name} (${visibleRange.start} to ${visibleRange.end})`}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setSelection({ type: "topic", planId: plan.id, courseId: course.id, topicId: topic.id });
                setDragState({
                  kind: "range",
                  mode: "move",
                  planId: plan.id,
                  courseId: course.id,
                  topicId: topic.id,
                  itemId: range.id,
                  originX: event.clientX,
                  originStart: range.start,
                  originEnd: range.end,
                  currentStart: range.start,
                  currentEnd: range.end,
                });
              }}
            >
              <GanttResizeHandle
                side="left"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragState({
                    kind: "range",
                    mode: "start",
                    planId: plan.id,
                    courseId: course.id,
                    topicId: topic.id,
                    itemId: range.id,
                    originX: event.clientX,
                    originStart: range.start,
                    originEnd: range.end,
                    currentStart: range.start,
                    currentEnd: range.end,
                  });
                }}
              />
              <GanttResizeHandle
                side="right"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragState({
                    kind: "range",
                    mode: "end",
                    planId: plan.id,
                    courseId: course.id,
                    topicId: topic.id,
                    itemId: range.id,
                    originX: event.clientX,
                    originStart: range.start,
                    originEnd: range.end,
                    currentStart: range.start,
                    currentEnd: range.end,
                  });
                }}
              />
            </GanttBar>
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
  onEdit,
  onEditDependencies,
  onDelete,
  onEditRange,
  onDeleteRange,
}: {
  plan?: Plan;
  selection: Selection;
  onAddTopic: () => void;
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
    <aside className="ui-panel p-4">
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
            <Button leadingIcon={<GitBranch size={15} />} onClick={onEditDependencies}>Edit</Button>
          </div>
          <div className="space-y-1">
            {topic.dependencies.length > 0 ? (
              topic.dependencies.map((dependencyId) => {
                const dependency = course?.topics.find((candidate) => candidate.id === dependencyId);
                return (
                  <div key={dependencyId} className="surface-row">
                    {dependency?.name ?? dependencyId}
                  </div>
                );
              })
            ) : (
              <div className="surface-row text-[var(--muted)]">No dependencies</div>
            )}
          </div>
          <h3 className="text-sm font-semibold">Study ranges</h3>
          {topic.ranges.length > 0 ? (
            topic.ranges.map((range) => (
              <div key={range.id} className="surface-row flex items-center justify-between gap-2">
                <span>{range.start} to {range.end}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <IconButton label="Edit range" icon={<Pencil size={14} />} onClick={() => onEditRange(range.id)} />
                  <IconButton label="Delete range" icon={<Trash2 size={14} />} onClick={() => onDeleteRange(range.id)} />
                </span>
              </div>
            ))
          ) : (
            <div className="surface-row text-[var(--muted)]">No study ranges</div>
          )}
        </div>
      ) : null}

      <div className="mt-5 grid gap-2">
        <Button className="w-full" leadingIcon={<BookOpen size={16} />} onClick={onAddTopic} disabled={!course}>Add topic</Button>
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-cell">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
    </div>
  );
}

function LoadingPlanner() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--app-bg)] px-4">
      <section className="auth-panel ui-panel w-full max-w-sm p-6 text-center">
        <div className="app-mark mx-auto mb-4">
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
    <Dialog
      open={target !== null}
      title={target?.title ?? "Delete item"}
      onClose={onCancel}
      icon={<Trash2 size={18} />}
      footer={
        <>
          <Button variant="invisible" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>Delete</Button>
        </>
      }
    >
      <p className="text-sm leading-6 text-[var(--muted)]">{target?.detail ?? "This action cannot be undone."}</p>
    </Dialog>
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
    <Dialog
      open={mode !== null}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="invisible" onClick={onClose}>Cancel</Button>
          {mode === "github" ? (
            <>
              <Button onClick={() => void previewGitHubImport()} disabled={githubBusy || !owner || !repo || (!usingConvex && !token)}>
                Preview
              </Button>
              <Button variant="primary" onClick={() => void submitGitHubImport()} disabled={githubBusy || !githubPreview}>
                Import
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={submit} disabled={!mode?.includes("range") && mode !== "dependencies" && !name.trim()}>
              Save
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4">
          {mode === "github" ? (
            <>
              <TextField
                label="Owner"
                value={owner}
                onChange={(event) => {
                  setOwner(event.currentTarget.value);
                  resetGitHubPreview();
                }}
              />
              <TextField
                label="Repository"
                value={repo}
                onChange={(event) => {
                  setRepo(event.currentTarget.value);
                  resetGitHubPreview();
                }}
              />
              <TextField
                label="Token"
                type="password"
                value={token}
                onChange={(event) => {
                  setToken(event.currentTarget.value);
                  resetGitHubPreview();
                }}
              />
              <p className="text-xs leading-5 text-[var(--muted)]">
                {usingConvex ? "Uses the configured Convex import token when this field is empty." : "Local imports need a token pasted here."}
              </p>
              {githubError ? <div className="rounded-[8px] bg-[#ffebe9] px-3 py-2 text-sm text-[#a4261d]">{githubError}</div> : null}
              {githubPreview ? (
                <div className="import-preview">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{githubPreview.planName}</p>
                      <p className="text-xs text-[var(--muted)]">{githubPreview.repository}</p>
                    </div>
                    <span className="ui-badge">{githubPreview.issueCount} issues</span>
                  </div>
                  {githubPreview.skippedSubissueCount ? (
                    <p className="mt-2 text-xs text-[var(--muted)]">Skipped {githubPreview.skippedSubissueCount} progress subissues.</p>
                  ) : null}
                  <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
                    {githubPreview.courses.map((course) => (
                      <div key={course.name} className="surface-row">
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
              <TextField label={mode === "milestone" ? "Milestone name" : "Name"} value={name} onChange={(event) => setName(event.currentTarget.value)} autoFocus={mode === "milestone"} />
              <TextArea label="Notes" value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
            </>
          ) : null}

          {mode && ["course", "topic", "edit-course", "edit-topic"].includes(mode) ? (
            <div className="planner-control-group">
              <p className="planner-control-label">Color</p>
              <div className="planner-color-grid">
                {applePalette.map((paletteColor) => (
                  <Button
                    key={paletteColor.value}
                    variant="unstyled"
                    className={clsx("planner-color-swatch", color === paletteColor.value && "selected")}
                    title={paletteColor.name}
                    aria-label={paletteColor.name}
                    style={{ background: paletteColor.value }}
                    onClick={() => setColor(paletteColor.value)}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {mode && ["milestone", "range", "edit-milestone", "edit-range"].includes(mode) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={mode === "milestone" ? "Date" : "Start date"} type="date" value={start} onChange={(event) => setStart(event.currentTarget.value || today)} />
              <TextField label="End date" type="date" value={end} onChange={(event) => setEnd(event.currentTarget.value || start)} />
            </div>
          ) : null}

          {mode === "dependencies" ? (
            <div className="planner-option-list">
              {dependencyOptions.length > 0 ? (
                dependencyOptions.map((topic) => (
                  <label key={topic.id} className="planner-option-row">
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
                <div className="planner-option-row text-[var(--muted)]">No other topics in this course</div>
              )}
            </div>
          ) : null}
      </div>
    </Dialog>
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

function summarizeGitHubImport(owner: string, repo: string, plan: Plan, issueCount: number, skippedSubissueCount: number): GitHubImportPreview {
  return {
    issueCount,
    skippedSubissueCount,
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

function formatGitHubImportToast(issueCount: number, skippedSubissueCount = 0) {
  return skippedSubissueCount > 0
    ? `Imported ${issueCount} GitHub issues; skipped ${skippedSubissueCount} subissues`
    : `Imported ${issueCount} GitHub issues`;
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