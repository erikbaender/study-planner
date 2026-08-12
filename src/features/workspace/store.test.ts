import { beforeEach, describe, expect, it } from "vitest";
import {
  requestRename,
  revealSelection,
  toggleRevealSelection,
  useWorkspace,
} from "./store";

const initial = useWorkspace.getState();

beforeEach(() => {
  useWorkspace.setState(initial, true);
});

describe("the workspace store", () => {
  it("lands on Today with everything in focus and nothing selected", () => {
    const state = useWorkspace.getState();
    expect(state.view).toBe("today");
    expect(state.focus).toEqual({ kind: "all" });
    expect(state.selection).toBeNull();
    expect(state.revealBlockId).toBeNull();
    expect(state.renameRequestId).toBeNull();
  });

  it("drops focus and selection when the semester changes", () => {
    // Every id in either belongs to the semester being left. Carrying them
    // across would leave the inspector describing something from elsewhere.
    useWorkspace.getState().setFocus({ kind: "attention" });
    useWorkspace.getState().toggleCourseHidden("course_1");
    useWorkspace.getState().select({ kind: "topic", id: "topic_1" });

    useWorkspace.getState().setPlan("plan_2");

    const state = useWorkspace.getState();
    expect(state.planId).toBe("plan_2");
    expect(state.focus).toEqual({ kind: "all" });
    expect(state.hiddenCourseIds).toEqual([]);
    expect(state.selection).toBeNull();
  });

  it("keeps the view when the semester changes", () => {
    // The view is how you look at things, not what you are looking at.
    useWorkspace.getState().setView("outline");
    useWorkspace.getState().setPlan("plan_2");
    expect(useWorkspace.getState().view).toBe("outline");
  });

  it("keeps focus and selection independent", () => {
    // You can inspect a topic in one course while focused on all of them.
    useWorkspace.getState().setFocus({ kind: "attention" });
    useWorkspace.getState().select({ kind: "topic", id: "topic_1" });

    expect(useWorkspace.getState().focus).toEqual({ kind: "attention" });
    expect(useWorkspace.getState().selection).toEqual({ kind: "topic", id: "topic_1" });
  });

  it("selects something when it is revealed", () => {
    revealSelection({ kind: "course", id: "course_1" });

    const state = useWorkspace.getState();
    expect(state.selection).toEqual({ kind: "course", id: "course_1" });
  });

  it("round-trips a block reveal request", () => {
    useWorkspace.getState().revealBlock("block_1");
    expect(useWorkspace.getState().revealBlockId).toBe("block_1");

    useWorkspace.getState().revealBlock(null);
    expect(useWorkspace.getState().revealBlockId).toBeNull();
  });

  it("round-trips a rename request", () => {
    requestRename("topic_1");
    expect(useWorkspace.getState().renameRequestId).toBe("topic_1");

    useWorkspace.getState().setRenameRequest(null);
    expect(useWorkspace.getState().renameRequestId).toBeNull();
  });

  it("clears the current entity when it is selected again", () => {
    toggleRevealSelection({ kind: "course", id: "course_1" });
    expect(useWorkspace.getState().selection).toEqual({ kind: "course", id: "course_1" });

    toggleRevealSelection({ kind: "course", id: "course_1" });
    expect(useWorkspace.getState().selection).toBeNull();
  });
});
