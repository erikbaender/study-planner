import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { course as makeCourse, exam as makeExam, topic as makeTopic } from "@/test/factories";
import { assessCourse, DEFAULT_PREFERENCES, type CourseHealth } from "@/domain";
import { Inspector } from "./inspector";

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
const inspectorNavigation = {
  onSelectCourse: vi.fn(),
  onSelectTopic: vi.fn(),
  onRevealBlock: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

function healthFor(course: Parameters<typeof assessCourse>[0]["course"]): Map<string, CourseHealth> {
  return new Map([
    [
      course.id,
      assessCourse({ course, today: TODAY, calendar: DEFAULT_PREFERENCES, log: [] }),
    ],
  ]);
}

describe("Inspector", () => {
  it("renders no inspector content when nothing is selected", () => {
    render(
      <Inspector
        {...inspectorNavigation}
        selection={null}
        health={new Map()}
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
          health={healthFor(course)}
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
          health={healthFor(course)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("combobox", { name: "Course for Glycolysis" }));
      await user.click(screen.getByRole("option", { name: "Neurobiology" }));

      expect(repository.moveTopic).toHaveBeenCalledWith(topic.id, targetCourse.id);
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
          health={healthFor(dependentCourse)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("checkbox", { name: "Cell biology" }));
      expect(repository.setTopicDependencies).toHaveBeenCalledWith(topic.id, [prerequisite.id]);
    });

    it("reveals a study block when its reference is clicked", async () => {
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
          health={healthFor(scheduledCourse)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      const references = screen.getByRole("list", { name: "Study blocks for Glycolysis" });
      await user.click(within(references).getByRole("button", { name: /Edit study block/ }));
      await user.click(screen.getByRole("button", { name: "Show on timeline" }));

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
          health={healthFor(scheduledCourse)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Add block" }));

      expect(repository.createStudyBlock).toHaveBeenCalledWith({
        topicId: scheduledTopic.id,
        startDate: "2026-05-07",
        endDate: "2026-05-07",
        source: "manual",
      });
    });

    it("moves a block when its start changes and resizes it when its end changes", async () => {
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
      const user = userEvent.setup();

      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "topic", course: scheduledCourse, topic: scheduledTopic }}
          health={healthFor(scheduledCourse)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("button", { name: /Edit study block 2026-05-04/ }));
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

    it("removes a block from its expanded editor", async () => {
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
          health={healthFor(scheduledCourse)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("button", { name: /Edit study block 2026-05-04/ }));
      await user.click(screen.getByRole("button", { name: "Remove" }));

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
          health={healthFor(course)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    });
  });

  describe("a course", () => {
    const course = makeCourse({
      name: "Biochemistry",
      topics: [makeTopic({ totalUnits: 100, completedUnits: 25 })],
      exams: [makeExam({ startDate: "2026-05-15" })],
    });

    it("shows the pace it can measure", () => {
      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "course", course }}
          health={healthFor(course)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.getByText("25 / 100 units")).toBeInTheDocument();
      // Nothing has been logged, so there is no velocity to extrapolate from
      // and no honest finish date to give.
      expect(screen.getByText("Not predictable yet")).toBeInTheDocument();
    });

    it("does not invent a pace for a course with no exam", () => {
      const undated = makeCourse({ name: "Elective", topics: [makeTopic({ totalUnits: 10 })] });
      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "course", course: undated }}
          health={healthFor(undated)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.getByText(/No upcoming exam to measure against/)).toBeInTheDocument();
    });

    it("changes the colour through a radiogroup", async () => {
      const user = userEvent.setup();
      render(
        <Inspector
          {...inspectorNavigation}
          selection={{ kind: "course", course }}
          health={healthFor(course)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("radio", { name: "Violet" }));
      expect(repository.updateCourse).toHaveBeenCalledWith(
        course.id,
        expect.objectContaining({ color: "violet", name: "Biochemistry" }),
      );
    });

    it("selects a topic when its course reference is clicked", async () => {
      const user = userEvent.setup();
      const onSelectTopic = vi.fn();
      render(
        <Inspector
          {...inspectorNavigation}
          onSelectTopic={onSelectTopic}
          selection={{ kind: "course", course }}
          health={healthFor(course)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      const references = screen.getByRole("list", { name: "Topics in Biochemistry" });
      await user.click(within(references).getByRole("button", { name: /^Topic/ }));

      expect(onSelectTopic).toHaveBeenCalledWith(course, course.topics[0]);
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
          health={healthFor(course)}
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
        health={healthFor(course)}
        today={TODAY}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete topic" }));
    expect(onDelete).toHaveBeenCalledWith({ kind: "topic", course, topic });
  });
});
