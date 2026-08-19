"use client";

/**
 * Ephemeral view state: which view is showing, what is in focus, what is
 * selected, whether the palette is open.
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

/**
 * The order the outline stacks its course cards in.
 *
 * Every other list in the app is alphabetical, because a list you scan for a
 * name you already know wants one predictable order. The outline is the list
 * you scan for *what to do next*, and that question is answered by the exam
 * calendar rather than by the alphabet — so it, and only it, offers the choice.
 */
export const COURSE_SORTS = ["name", "exam"] as const;
export type CourseSort = (typeof COURSE_SORTS)[number];

export const COURSE_SORT_LABELS: Record<CourseSort, string> = {
  name: "Alphabetical",
  exam: "Chronological",
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
  /**
   * Courses the outline has been told to close.
   *
   * Stored as the *exception* rather than as the set of open ones, because the
   * outline is where the material lives and a course that shows nothing until
   * you ask is a filing cabinet. Kept here rather than in the view so that
   * switching to the timeline and back does not silently reopen everything, and
   * — the reason it moved out of the component at all — so that expansion
   * cannot be derived from the selection: it used to be, and opening one course
   * by hand then selecting another reversed it.
   */
  collapsedCourseIds: EntityId[];
  /**
   * The outline's course order. View state rather than a preference: it lives
   * here so switching to the timeline and back does not silently reset it, the
   * way component state in a view the shell unmounts would.
   */
  courseSort: CourseSort;
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
  /**
   * A block the timeline should select and scroll to the next time it renders.
   *
   * The chart owns which bars are selected — a selection there can span several
   * topics, which the one-entity workspace selection cannot express — so a
   * reference followed from the inspector cannot simply be written into
   * `selection`. It is handed over as a request and cleared by the chart once
   * honoured, which also keeps a stale id from re-selecting on every mount.
   */
  revealBlockId: EntityId | null;
  /** A course the outline should scroll to after it has mounted. */
  revealCourseId: EntityId | null;
  /**
   * Something just created, whose name the inspector should put the caret in.
   *
   * A brand-new topic is a placeholder for a name that has not been typed yet,
   * and asking someone to click the field they were already looking at is a
   * click the app could have saved them. Cleared as soon as the field takes it,
   * so re-selecting the same topic later does not steal focus.
   */
  renameRequestId: EntityId | null;

  setPlan: (planId: EntityId | null) => void;
  setView: (view: ViewId) => void;
  setFocus: (focus: Focus) => void;
  toggleCourseHidden: (courseId: EntityId) => void;
  hideAllCourses: (courseIds: EntityId[]) => void;
  showAllCourses: () => void;
  select: (selection: Selection) => void;
  toggleCourseCollapsed: (courseId: EntityId) => void;
  foldCourses: (courseIds: EntityId[]) => void;
  unfoldCourses: (courseIds: EntityId[]) => void;
  setCourseSort: (sort: CourseSort) => void;
  revealBlock: (blockId: EntityId | null) => void;
  revealCourse: (courseId: EntityId | null) => void;
  setRenameRequest: (id: EntityId | null) => void;
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
  collapsedCourseIds: [],
  courseSort: "name",
  revealBlockId: null,
  revealCourseId: null,
  renameRequestId: null,
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
      collapsedCourseIds: [],
      selection: null,
      revealCourseId: null,
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
  toggleCourseCollapsed: (courseId) =>
    set((state) => ({
      collapsedCourseIds: state.collapsedCourseIds.includes(courseId)
        ? state.collapsedCourseIds.filter((id) => id !== courseId)
        : [...state.collapsedCourseIds, courseId],
    })),
  foldCourses: (courseIds) =>
    set((state) => ({
      collapsedCourseIds: [...new Set([...state.collapsedCourseIds, ...courseIds])],
    })),
  unfoldCourses: (courseIds) => {
    const opened = new Set(courseIds);
    set((state) => ({
      collapsedCourseIds: state.collapsedCourseIds.filter((id) => !opened.has(id)),
    }));
  },
  setCourseSort: (courseSort) => set({ courseSort }),
  revealBlock: (revealBlockId) => set({ revealBlockId }),
  revealCourse: (revealCourseId) =>
    set((state) =>
      revealCourseId === null
        ? { revealCourseId: null }
        : {
            view: "outline",
            revealCourseId,
            collapsedCourseIds: state.collapsedCourseIds.filter((id) => id !== revealCourseId),
          },
    ),
  setRenameRequest: (renameRequestId) => set({ renameRequestId }),
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
 * Selecting something *is* revealing it.
 *
 * The inspector used to have a switch of its own, which meant a selection could
 * be made with nowhere for it to show and the panel could be open describing
 * nothing. The panel is now a function of the selection: something selected
 * shows it, nothing selected hides it, and this function survives only because
 * a great many callers read better saying what they mean.
 */
export function revealSelection(selection: Selection) {
  useWorkspace.getState().select(selection);
}

/** Ask the inspector to put the caret in the name of something just created. */
export function requestRename(id: EntityId) {
  useWorkspace.getState().setRenameRequest(id);
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
