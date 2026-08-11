import { beforeEach, describe, expect, it } from "vitest";
import { toggleSelection, useWorkspace } from "./store";

const initial = useWorkspace.getState();

beforeEach(() => {
  useWorkspace.setState(initial, true);
});

describe("the workspace store", () => {
  it("lands on Today with everything in focus and nothing selected", () => {
    // Today as the landing view is a signed-off decision, not a default that
    // happened. The inspector starts closed because an inspector that opens
    // itself takes a third of the window from someone who has asked nothing.
    const state = useWorkspace.getState();
    expect(state.view).toBe("today");
    expect(state.focus).toEqual({ kind: "all" });
    expect(state.selection).toBeNull();
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

  it("derives the inspector state from selection", () => {
    // There is no second switch to keep in agreement with the highlighted row:
    // selecting gives the inspector something to describe, and clearing the
    // selection removes it.
    useWorkspace.getState().select({ kind: "course", id: "course_1" });
    expect(useWorkspace.getState().selection).toEqual({ kind: "course", id: "course_1" });

    useWorkspace.getState().select(null);
    expect(useWorkspace.getState().selection).toBeNull();
  });

  it("accepts every selectable entity kind", () => {
    // The store carries ids only; resolving each id against the current plan
    // belongs to scope. It still needs to preserve every kind that the five
    // inspector panels can receive.
    const selections = [
      { kind: "plan", id: "plan_1" },
      { kind: "course", id: "course_1" },
      { kind: "topic", id: "topic_1" },
      { kind: "exam", id: "exam_1" },
      { kind: "block", id: "block_1" },
    ] as const;

    for (const selection of selections) {
      useWorkspace.getState().select(selection);
      expect(useWorkspace.getState().selection).toEqual(selection);
    }
  });

  it("clears the current entity when it is selected again", () => {
    toggleSelection({ kind: "course", id: "course_1" });
    expect(useWorkspace.getState().selection).toEqual({ kind: "course", id: "course_1" });

    toggleSelection({ kind: "course", id: "course_1" });
    expect(useWorkspace.getState().selection).toBeNull();
  });
});
