import { create } from "zustand";

export type WorkspaceView = "today" | "timeline" | "outline";
export type SmartView = "today" | "upcoming" | "behind";
export type WorkspaceSelection =
  | { kind: "course"; id: string }
  | { kind: "topic"; id: string }
  | null;

type WorkspaceState = {
  view: WorkspaceView;
  smartView: SmartView;
  planId: string | null;
  courseId: string | null;
  selection: WorkspaceSelection;
  inspectorOpen: boolean;
  commandOpen: boolean;
  commandQuery: string;
  createOpen: boolean;
  deleteOpen: boolean;
  setView: (view: WorkspaceView) => void;
  activateSmartView: (smartView: SmartView) => void;
  selectPlan: (planId: string) => void;
  selectCourse: (courseId: string) => void;
  selectTopic: (topicId: string, courseId: string) => void;
  clearSelection: () => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  openCommand: (query?: string) => void;
  setCommandOpen: (open: boolean) => void;
  setCommandQuery: (query: string) => void;
  setCreateOpen: (open: boolean) => void;
  setDeleteOpen: (open: boolean) => void;
};

const INITIAL_STATE = {
  view: "today" as const,
  smartView: "today" as const,
  planId: null,
  courseId: null,
  selection: null,
  inspectorOpen: true,
  commandOpen: false,
  commandQuery: "",
  createOpen: false,
  deleteOpen: false,
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...INITIAL_STATE,
  setView: (view) =>
    set({
      view,
      smartView: view === "today" ? "today" : INITIAL_STATE.smartView,
    }),
  activateSmartView: (smartView) => set({ smartView, view: "today" }),
  selectPlan: (planId) =>
    set({
      planId,
      courseId: null,
      selection: null,
      view: "today",
      smartView: "today",
    }),
  selectCourse: (courseId) =>
    set({
      courseId,
      selection: { kind: "course", id: courseId },
      view: "outline",
    }),
  selectTopic: (topicId, courseId) =>
    set({
      courseId,
      selection: { kind: "topic", id: topicId },
      inspectorOpen: true,
    }),
  clearSelection: () => set({ selection: null }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  openCommand: (commandQuery = "") => set({ commandOpen: true, commandQuery }),
  setCommandOpen: (commandOpen) =>
    set(commandOpen ? { commandOpen } : { commandOpen, commandQuery: "" }),
  setCommandQuery: (commandQuery) => set({ commandQuery }),
  setCreateOpen: (createOpen) => set({ createOpen }),
  setDeleteOpen: (deleteOpen) => set({ deleteOpen }),
}));

export function resetWorkspaceStore() {
  useWorkspaceStore.setState(INITIAL_STATE);
}
