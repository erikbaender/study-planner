"use client";

/**
 * Ephemeral view state: which view is showing, what is in focus, what is
 * selected, whether the inspector and the palette are open.
 *
 * None of this is data. It is not persisted and it is not synced — reopening
 * the app on another device should not drag someone back to the topic they had
 * selected on their laptop. Everything durable lives behind `PlannerRepository`.
 *
 * It is a store rather than component state because three unrelated places move
 * the same values: the toolbar, the keyboard map, and the command palette. With
 * `useState` in the shell, every one of them would need the setters threaded
 * down to it, and the palette — which can run *any* action — would need all of
 * them at once.
 *
 * The two axes are deliberately separate:
 *
 * - **focus** is *which courses you are looking at* — all of them, the ones that
 *   need attention, or the ones with exams soon.
 * - **view** is *how they are shown* — Today, Timeline, or Outline.
 *
 * macOS splits these the same way: the sidebar picks the source, the toolbar
 * picks the presentation. Collapsing them into one "page" idea is what produces
 * apps where selecting a course mysteriously changes the layout.
 */

import { create } from "zustand";
import type { EntityId } from "@/domain";

export const VIEWS = ["today", "timeline", "outline"] as const;
export type ViewId = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<ViewId, string> = {
  today: "Today",
  timeline: "Timeline",
  outline: "Outline",
};

/** Fired synchronously before a workspace filter can change rendered course geometry. */
export const COURSE_FILTER_WILL_CHANGE = "planner:course-filter-will-change";

function announceCourseFilterChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COURSE_FILTER_WILL_CHANGE));
}

/**
 * Which courses are in scope.
 *
 * Questions rather than folders — "what is behind", "what is coming" — resolved
 * against live metrics on every render instead of stored as membership.
 *
 * There is deliberately no "one course" focus: the sidebar filters visibility
 * without turning course rows into navigation.
 */
export type Focus = { kind: "all" } | { kind: "attention" } | { kind: "soon" };

/** What the inspector is describing. Independent of focus: you can inspect a topic in one course while focused on all of them. */
export type Selection =
  | { kind: "course"; id: EntityId }
  | { kind: "topic"; id: EntityId }
  | { kind: "exam"; id: EntityId }
  | null;

export type WorkspaceState = {
  /** `null` until a snapshot arrives; the shell picks the first plan then. */
  planId: EntityId | null;
  view: ViewId;
  focus: Focus;
  /**
   * Courses the sidebar has switched off. A filter, not a property of the
   * course — nothing is written to the repository, and reopening the app shows
   * everything again.
   */
  hiddenCourseIds: EntityId[];
  selection: Selection;
  inspectorOpen: boolean;
  paletteOpen: boolean;
  /** Which create sheet is up, if any. */
  creating: "plan" | "course" | null;
  /**
   * What ⌘⌫ is asking about. There is no undo in this app yet, so a delete
   * always goes through a confirmation rather than happening and offering to be
   * taken back — the pattern macOS uses is not available to us.
   */
  pendingDelete: Selection;
  /** The sidebar search field. Filters courses and topics in every view. */
  query: string;

  setPlan: (planId: EntityId | null) => void;
  setView: (view: ViewId) => void;
  setFocus: (focus: Focus) => void;
  toggleCourseHidden: (courseId: EntityId) => void;
  hideAllCourses: (courseIds: EntityId[]) => void;
  showAllCourses: () => void;
  select: (selection: Selection) => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  setPaletteOpen: (open: boolean) => void;
  setCreating: (creating: "plan" | "course" | null) => void;
  setPendingDelete: (selection: Selection) => void;
  setQuery: (query: string) => void;
};

export const useWorkspace = create<WorkspaceState>((set) => ({
  // Today is the landing view — signed off in §11, and the answer to the
  // question the persona actually opens the app with.
  planId: null,
  view: "today",
  focus: { kind: "all" },
  hiddenCourseIds: [],
  selection: null,
  // Closed by default. An inspector that opens itself on load takes a third of
  // the window away from someone who has not asked a question yet.
  inspectorOpen: false,
  paletteOpen: false,
  creating: null,
  pendingDelete: null,
  query: "",

  // Switching semester drops both focus and selection, because every id in
  // them belongs to the semester being left.
  setPlan: (planId) =>
    set({
      planId,
      focus: { kind: "all" },
      hiddenCourseIds: [],
      selection: null,
    }),
  setView: (view) => set({ view }),
  setFocus: (focus) =>
    set((state) => {
      if (state.focus.kind === focus.kind) return state;
      announceCourseFilterChange();
      return { focus };
    }),

  toggleCourseHidden: (courseId) =>
    set((state) => {
      announceCourseFilterChange();
      return {
        hiddenCourseIds: state.hiddenCourseIds.includes(courseId)
          ? state.hiddenCourseIds.filter((id) => id !== courseId)
          : [...state.hiddenCourseIds, courseId],
      };
    }),

  hideAllCourses: (courseIds) =>
    set((state) => {
      if (
        state.hiddenCourseIds.length === courseIds.length &&
        state.hiddenCourseIds.every((id, index) => id === courseIds[index])
      ) {
        return state;
      }
      announceCourseFilterChange();
      return { hiddenCourseIds: [...courseIds] };
    }),
  showAllCourses: () =>
    set((state) => {
      if (state.hiddenCourseIds.length === 0) return state;
      announceCourseFilterChange();
      return { hiddenCourseIds: [] };
    }),
  select: (selection) => set({ selection }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setCreating: (creating) => set({ creating }),
  setPendingDelete: (pendingDelete) => set({ pendingDelete }),
  setQuery: (query) =>
    set((state) => {
      if (state.query === query) return state;
      announceCourseFilterChange();
      return { query };
    }),
}));

/**
 * Selecting something is nearly always also a request to see it, so the two are
 * one action rather than two calls every caller has to remember to pair.
 */
export function revealSelection(selection: Selection) {
  const { select, setInspectorOpen } = useWorkspace.getState();
  select(selection);
  setInspectorOpen(true);
}

/** Select an entity for inspection, or clear it when the same entity is clicked again. */
export function toggleRevealSelection(selection: Exclude<Selection, null>) {
  const current = useWorkspace.getState().selection;
  if (current?.kind === selection.kind && current.id === selection.id) {
    useWorkspace.getState().select(null);
    return;
  }
  revealSelection(selection);
}
