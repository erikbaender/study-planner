import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace, revealSelection } from "./store";

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
    expect(state.inspectorOpen).toBe(false);
  });

  it("drops focus and selection when the semester changes", () => {
    // Every id in either belongs to the semester being left. Carrying them
    // across would leave the inspector describing something from elsewhere.
    useWorkspace.getState().setFocus({ kind: "course", courseId: "course_1" });
    useWorkspace.getState().select({ kind: "topic", id: "topic_1" });

    useWorkspace.getState().setPlan("plan_2");

    const state = useWorkspace.getState();
    expect(state.planId).toBe("plan_2");
    expect(state.focus).toEqual({ kind: "all" });
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
    useWorkspace.getState().setFocus({ kind: "behind" });
    useWorkspace.getState().select({ kind: "topic", id: "topic_1" });

    expect(useWorkspace.getState().focus).toEqual({ kind: "behind" });
    expect(useWorkspace.getState().selection).toEqual({ kind: "topic", id: "topic_1" });
  });

  it("toggles the inspector both ways", () => {
    useWorkspace.getState().toggleInspector();
    expect(useWorkspace.getState().inspectorOpen).toBe(true);
    useWorkspace.getState().toggleInspector();
    expect(useWorkspace.getState().inspectorOpen).toBe(false);
  });

  it("opens the inspector as part of revealing something", () => {
    // Selecting is nearly always also a request to see it, so the two are one
    // action rather than two calls every caller has to remember to pair.
    revealSelection({ kind: "course", id: "course_1" });

    const state = useWorkspace.getState();
    expect(state.selection).toEqual({ kind: "course", id: "course_1" });
    expect(state.inspectorOpen).toBe(true);
  });
});
