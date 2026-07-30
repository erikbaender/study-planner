import { beforeEach, describe, expect, it } from "vitest";
import { resetWorkspaceStore, useWorkspaceStore } from "./workspace-store";

describe("workspace store", () => {
  beforeEach(resetWorkspaceStore);

  it("opens a course in Outline and makes it the inspector selection", () => {
    useWorkspaceStore.getState().selectCourse("course_1");

    expect(useWorkspaceStore.getState()).toMatchObject({
      view: "outline",
      courseId: "course_1",
      selection: { kind: "course", id: "course_1" },
    });
  });

  it("opens a selected topic in the inspector without changing the active view", () => {
    useWorkspaceStore.getState().setView("timeline");
    useWorkspaceStore.getState().setInspectorOpen(false);
    useWorkspaceStore.getState().selectTopic("topic_1", "course_1");

    expect(useWorkspaceStore.getState()).toMatchObject({
      view: "timeline",
      courseId: "course_1",
      selection: { kind: "topic", id: "topic_1" },
      inspectorOpen: true,
    });
  });

  it("resets command search when the palette closes", () => {
    useWorkspaceStore.getState().openCommand("biochem");
    useWorkspaceStore.getState().setCommandOpen(false);

    expect(useWorkspaceStore.getState()).toMatchObject({
      commandOpen: false,
      commandQuery: "",
    });
  });
});
