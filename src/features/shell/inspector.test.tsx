import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coursePalette } from "@/domain";
import { course as makeCourse, exam as makeExam, topic as makeTopic } from "@/test/factories";
import { DraftText } from "./inspector/shared";
import { Inspector, isInspectable } from "./inspector";

/**
 * The repository is mocked at the module boundary rather than provided through
 * context: `RepositoryProvider` reaches for a Convex client, and standing one up
 * would test Convex rather than the panel.
 */
const repository = {
  updateCourse: vi.fn(() => Promise.resolve()),
  updateTopic: vi.fn(() => Promise.resolve()),
  moveTopic: vi.fn(() => Promise.resolve()),
  logStudy: vi.fn(() => Promise.resolve()),
  setTopicDependencies: vi.fn(() => Promise.resolve()),
  createStudyBlock: vi.fn(() => Promise.resolve("block_new")),
  updateStudyBlock: vi.fn(() => Promise.resolve()),
  deleteStudyBlock: vi.fn(() => Promise.resolve()),
};
const run = vi.fn();

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerRun: () => run,
  usePlannerState: () => ({ status: "ready", snapshot: { plans: [] } }),
  usePlannerErrors: () => ({ run, error: null, clear: () => {} }),
}));

const TODAY = "2026-05-01";
const inspectorNavigation = { onRevealBlock: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Inspector", () => {
  it("renders no inspector content when nothing is selected", () => {
    render(
      <Inspector
        {...inspectorNavigation}
        selection={null}
        today={TODAY}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeEmptyDOMElement();
  });

  describe("a topic", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      totalUnits: 100,
      completedUnits: 40,
      notes: "Skip the appendix",
    });
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });
    const selection = { kind: "topic", course, topic } as const;

    function renderTopic() {
      render(
        <Inspector
          {...inspectorNavigation}
          selection={selection}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );
    }

    it("logs a delta rather than writing progress directly", async () => {
      // The rule the whole panel is built around. Setting `completedUnits`
      // through `updateTopic` would move the number while leaving velocity and
      // the pace projection with no record to measure.
      const user = userEvent.setup();
      renderTopic();

      await user.click(screen.getByRole("slider", { name: "Glycolysis progress" }));
      await user.keyboard("{ArrowRight}");

      expect(repository.logStudy).toHaveBeenCalledWith({
        topicId: topic.id,
        date: TODAY,
        units: 1,
      });
      expect(repository.updateTopic).not.toHaveBeenCalled();
    });

    it("keeps the completion checkbox synchronized with inspector progress", async () => {
      const user = userEvent.setup();
      renderTopic();

      const checkbox = screen.getByRole("checkbox", { name: "Mark Glycolysis as done" });
      expect(checkbox).not.toBeChecked();
      await user.click(checkbox);

      expect(repository.logStudy).toHaveBeenCalledWith({
        topicId: topic.id,
        date: TODAY,
        units: 60,
      });
      expect(checkbox).toBeChecked();
      expect(checkbox.closest(".topic-completion-row")).toHaveStyle({
        "--topic-completion-color": "#8169d1",
      });
    });

    it("drops its progress preview when stored progress changes elsewhere", async () => {
      const user = userEvent.setup();
      const empty = makeTopic({ ...topic, completedUnits: 0 });
      const full = makeTopic({ ...topic, completedUnits: 100 });
      const emptySelection = { kind: "topic", course, topic: empty } as const;
      const { rerender } = render(
        <Inspector
          {...inspectorNavigation}
          selection={emptySelection}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      const checkbox = screen.getByRole("checkbox", { name: "Mark Glycolysis as done" });
      await user.click(checkbox);
      expect(checkbox).toBeChecked();

      rerender(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "topic", course, topic: full }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );
      rerender(
        <Inspector
          {...inspectorNavigation}
          selection={emptySelection}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      expect(checkbox).not.toBeChecked();
      expect(screen.getByText("0 / 100 slides")).toBeInTheDocument();
    });

    it("passes completedUnits through untouched when something else is edited", async () => {
      // `updateTopic` takes a whole topic, so every edit resends the field.
      // Resending anything other than the current value would silently
      // overwrite progress logged in the meantime.
      const user = userEvent.setup();
      renderTopic();

      await user.click(screen.getByRole("radio", { name: "High" }));

      expect(repository.updateTopic).toHaveBeenCalledWith(
        topic.id,
        expect.objectContaining({ priority: "high", completedUnits: 40, totalUnits: 100 }),
      );
    });

    it("commits a renamed topic on blur, not on every keystroke", async () => {
      const user = userEvent.setup();
      renderTopic();

      const field = screen.getByLabelText("Topic name");
      await user.clear(field);
      await user.type(field, "Glycolysis I");
      expect(repository.updateTopic).not.toHaveBeenCalled();

      await user.tab();
      expect(repository.updateTopic).toHaveBeenCalledTimes(1);
      expect(repository.updateTopic).toHaveBeenCalledWith(
        topic.id,
        expect.objectContaining({ name: "Glycolysis I" }),
      );
    });

    it("moves the topic through the course picker", async () => {
      const targetCourse = makeCourse({ name: "Neurobiology" });
      const user = userEvent.setup();
      render(
        <Inspector
          {...inspectorNavigation}
          courses={[course, targetCourse]}
          selection={selection}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("combobox", { name: "Course for Glycolysis" }));
      await user.click(screen.getByRole("option", { name: "Neurobiology" }));

      expect(repository.moveTopic).toHaveBeenCalledWith(topic.id, targetCourse.id);
    });

    it("lists destination courses alphabetically", async () => {
      const zoology = makeCourse({ name: "Zoology" });
      const anatomy = makeCourse({ name: "Anatomy" });
      const user = userEvent.setup();
      render(
        <Inspector
          {...inspectorNavigation}
          courses={[zoology, course, anatomy]}
          selection={selection}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("combobox", { name: "Course for Glycolysis" }));
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Anatomy",
        "Biochemistry",
        "Zoology",
      ]);
    });

    it("reverts an edit on Escape", async () => {
      const user = userEvent.setup();
      renderTopic();

      const field = screen.getByLabelText("Topic name");
      await user.type(field, " and friends{Escape}");

      expect(field).toHaveValue("Glycolysis");
      expect(repository.updateTopic).not.toHaveBeenCalled();
    });

    it("does not write when the value has not changed", async () => {
      const user = userEvent.setup();
      renderTopic();

      await user.click(screen.getByLabelText("Topic name"));
      await user.tab();

      expect(repository.updateTopic).not.toHaveBeenCalled();
    });

    it("lets a prerequisite be added", async () => {
      const prerequisite = makeTopic({ name: "Cell biology" });
      const dependentCourse = makeCourse({ topics: [prerequisite, topic] });
      const user = userEvent.setup();
      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "topic", course: dependentCourse, topic }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("checkbox", { name: "Cell biology" }));
      expect(repository.setTopicDependencies).toHaveBeenCalledWith(topic.id, [prerequisite.id]);
    });

    it("focuses a block in the timeline from its context menu", async () => {
      const block = {
        id: "block_1",
        topicId: topic.id,
        startDate: "2026-05-04",
        endDate: "2026-05-06",
        source: "manual" as const,
      };
      const scheduledTopic = makeTopic({ name: "Glycolysis", blocks: [block] });
      const scheduledCourse = makeCourse({ name: "Biochemistry", topics: [scheduledTopic] });
      const onRevealBlock = vi.fn();
      const user = userEvent.setup();

      render(
        <Inspector
          {...inspectorNavigation}
          onRevealBlock={onRevealBlock}
          selection={{ kind: "topic", course: scheduledCourse, topic: scheduledTopic }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      const blocks = screen.getByRole("list", { name: "Study blocks for Glycolysis" });
      await user.pointer({ keys: "[MouseRight]", target: within(blocks).getByLabelText("Starts") });
      await user.click(await screen.findByRole("menuitem", { name: "Focus in timeline" }));

      expect(onRevealBlock).toHaveBeenCalledWith(block);
    });

    it("adds a manual block after the topic's last block", async () => {
      const lastBlock = {
        id: "block_last",
        topicId: topic.id,
        startDate: "2026-05-04",
        endDate: "2026-05-06",
        source: "manual" as const,
      };
      const scheduledTopic = makeTopic({ blocks: [lastBlock] });
      const scheduledCourse = makeCourse({ topics: [scheduledTopic] });
      const user = userEvent.setup();

      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "topic", course: scheduledCourse, topic: scheduledTopic }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      // The section's own plus, in its label — the same control the outline
      // adds topics and exams with.
      await user.click(
        screen.getByRole("button", { name: `Add a study block to ${scheduledTopic.name}` }),
      );

      expect(repository.createStudyBlock).toHaveBeenCalledWith({
        topicId: scheduledTopic.id,
        startDate: "2026-05-07",
        endDate: "2026-05-07",
        source: "manual",
      });
    });

    it("moves a block when its start changes and resizes it when its end changes", () => {
      const block = {
        id: "block_dates",
        topicId: topic.id,
        startDate: "2026-05-04",
        endDate: "2026-05-06",
        source: "auto" as const,
        plannedUnits: 12,
      };
      const scheduledTopic = makeTopic({ blocks: [block] });
      const scheduledCourse = makeCourse({ topics: [scheduledTopic] });

      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "topic", course: scheduledCourse, topic: scheduledTopic }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2026-05-10" } });
      expect(repository.updateStudyBlock).toHaveBeenCalledWith("block_dates", {
        startDate: "2026-05-10",
        endDate: "2026-05-12",
        plannedUnits: 12,
      });

      fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2026-05-14" } });
      expect(repository.updateStudyBlock).toHaveBeenLastCalledWith("block_dates", {
        startDate: "2026-05-04",
        endDate: "2026-05-14",
        plannedUnits: 12,
      });
    });

    it("removes a block from its context menu", async () => {
      const block = {
        id: "block_remove",
        topicId: topic.id,
        startDate: "2026-05-04",
        endDate: "2026-05-06",
        source: "manual" as const,
      };
      const scheduledTopic = makeTopic({ blocks: [block] });
      const scheduledCourse = makeCourse({ topics: [scheduledTopic] });
      const user = userEvent.setup();

      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "topic", course: scheduledCourse, topic: scheduledTopic }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("Starts") });
      await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

      expect(repository.deleteStudyBlock).toHaveBeenCalledWith("block_remove");
    });
  });

  describe("a topic with no size", () => {
    const topic = makeTopic({ name: "Reading list", totalUnits: 0 });
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });

    it("offers no slider, because there is no scale to slide along", () => {
      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "topic", course, topic }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    });
  });

  describe("a course", () => {
    const course = makeCourse({ name: "Biochemistry", code: "BIO-201", topics: [makeTopic()] });

    it("is something the inspector describes", () => {
      expect(isInspectable({ kind: "course", course })).toBe(true);
      expect(isInspectable({ kind: "topic", course, topic: makeTopic() })).toBe(true);
      expect(isInspectable(null)).toBe(false);
    });

    it("offers the creation sheet's fields and nothing about the topics inside it", () => {
      // The topics are in the card beside the panel, with their own progress
      // and their own actions. Listing them here too was a second, poorer copy
      // of the view the panel is standing next to.
      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "course", course }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.getByLabelText("Course name")).toHaveValue("Biochemistry");
      expect(screen.getByLabelText("Course code")).toHaveValue("BIO-201");
      expect(screen.getByRole("radiogroup", { name: "Course colour" })).toBeInTheDocument();
      expect(screen.getByLabelText("Notes")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(screen.queryByText(course.topics[0].name)).not.toBeInTheDocument();
    });

    it("resends the course's other fields when one of them is edited", async () => {
      const user = userEvent.setup();
      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "course", course }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("radio", { name: coursePalette[2].name }));

      expect(repository.updateCourse).toHaveBeenCalledWith(course.id, {
        name: "Biochemistry",
        code: "BIO-201",
        color: coursePalette[2].id,
        notes: course.notes,
      });
    });
  });

  describe("an exam", () => {
    it("marks a provisional date as provisional and explains the consequence", () => {
      const exam = makeExam({
        name: "Written",
        startDate: "2026-06-01",
        endDate: "2026-06-14",
        status: "provisional",
      });
      const course = makeCourse({ name: "Biochemistry", exams: [exam] });

      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "exam", course, exam }}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.getByText("Provisional")).toBeInTheDocument();
      // The window's end is the field that makes it provisional, so it is
      // editable rather than merely reported.
      expect(screen.getByLabelText("Window ends")).toHaveValue("2026-06-14");
      expect(screen.getByText(/counts backwards from the/)).toBeInTheDocument();
    });
  });

  describe("changing what is selected", () => {
    // The panel swaps its content the way the views swap theirs: half the
    // shared motion out, half back in. jsdom has no stylesheet, so
    // `motionDuration` falls back to the same 240ms the stylesheet declares.
    const HALF_MOTION_MS = 120;
    const first = makeTopic({ name: "Glycolysis", totalUnits: 10 });
    const second = makeTopic({ name: "Krebs cycle", totalUnits: 10 });
    const third = makeTopic({ name: "Electron transport", totalUnits: 10 });
    const course = makeCourse({ name: "Biochemistry", topics: [first, second, third] });
    const select = (topic: typeof first) => ({ kind: "topic", course, topic }) as const;

    const panel = () =>
      render(
        <Inspector
          {...inspectorNavigation}
          selection={select(first)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );
    const content = () => document.querySelector(".inspector-content");
    const leaving = () => content()?.getAttribute("data-inspector-fade") === "out";

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("takes the old content away over half the shared motion", () => {
      const { rerender } = panel();

      rerender(
        <Inspector
          {...inspectorNavigation}
          selection={select(second)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      // The click is answered in the commit it caused: the fade is already
      // running, with the outgoing topic still legible.
      expect(leaving()).toBe(true);
      expect(screen.getByLabelText("Topic name")).toHaveValue("Glycolysis");

      act(() => void vi.advanceTimersByTime(HALF_MOTION_MS));
      expect(screen.getByLabelText("Topic name")).toHaveValue("Krebs cycle");
      expect(leaving()).toBe(false);
    });

    it("does not restart the fade when the selection changes again during it", () => {
      const { rerender } = panel();

      rerender(
        <Inspector
          {...inspectorNavigation}
          selection={select(second)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );
      act(() => void vi.advanceTimersByTime(HALF_MOTION_MS / 2));
      rerender(
        <Inspector
          {...inspectorNavigation}
          selection={select(third)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      // The clock belongs to the content leaving. What lands at the end of it
      // is whatever is selected by then — the third topic, never the second.
      act(() => void vi.advanceTimersByTime(HALF_MOTION_MS / 2));
      expect(screen.getByLabelText("Topic name")).toHaveValue("Electron transport");
    });

    it("turns a fade around when its own selection comes back", () => {
      const { rerender } = panel();

      rerender(
        <Inspector
          {...inspectorNavigation}
          selection={select(second)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );
      act(() => void vi.advanceTimersByTime(HALF_MOTION_MS / 2));
      rerender(
        <Inspector
          {...inspectorNavigation}
          selection={select(first)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      // Clicked away and back inside the fade: the content stops leaving at
      // once and comes back up from the opacity it had reached, rather than
      // completing a departure and a return nobody asked for.
      expect(leaving()).toBe(false);
      expect(screen.getByLabelText("Topic name")).toHaveValue("Glycolysis");

      act(() => void vi.advanceTimersByTime(HALF_MOTION_MS));
      expect(screen.getByLabelText("Topic name")).toHaveValue("Glycolysis");
      expect(leaving()).toBe(false);
    });

    it("empties itself only once the last content has gone", () => {
      const { rerender } = panel();

      rerender(
        <Inspector {...inspectorNavigation} selection={null} today={TODAY} onDelete={vi.fn()} />,
      );
      expect(leaving()).toBe(true);

      act(() => void vi.advanceTimersByTime(HALF_MOTION_MS));
      expect(screen.getByRole("complementary", { name: "Inspector" })).toBeEmptyDOMElement();
    });
  });

  it("asks before deleting rather than deleting", async () => {
    // There is no undo, so the macOS "do it and offer to take it back" pattern
    // is not available. The panel hands the request up instead of acting.
    const onDelete = vi.fn();
    const topic = makeTopic({ name: "Glycolysis", totalUnits: 10 });
    const course = makeCourse({ topics: [topic] });
    const user = userEvent.setup();

    render(
      <Inspector
        {...inspectorNavigation}
        selection={{ kind: "topic", course, topic }}
        today={TODAY}
        onDelete={onDelete}
      />,
    );

    // "Delete", not "Delete topic": a control never repeats the name of the
    // object it is already pointing at.
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith({ kind: "topic", course, topic });
  });
});

it("keeps an inspector draft bound to the snapshot where typing started", async () => {
  const originalSave = vi.fn();
  const newerSave = vi.fn();
  const user = userEvent.setup();
  const { rerender } = render(<DraftText label="Notes" value="Original" onCommit={originalSave} />);
  await user.type(screen.getByLabelText("Notes"), " draft");
  rerender(<DraftText label="Notes" value="Original" onCommit={newerSave} />);
  await user.tab();
  expect(originalSave).toHaveBeenCalledWith("Original draft");
  expect(newerSave).not.toHaveBeenCalled();
});
