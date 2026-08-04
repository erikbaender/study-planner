import { render, screen } from "@testing-library/react";
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
  logStudy: vi.fn(() => Promise.resolve()),
  setTopicDependencies: vi.fn(() => Promise.resolve()),
};
const run = vi.fn();

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerErrors: () => ({ run, error: null, clear: () => {} }),
}));

const TODAY = "2026-05-01";

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
  it("says nothing is selected rather than showing an empty form", () => {
    render(<Inspector selection={null} health={new Map()} today={TODAY} onDelete={vi.fn()} />);
    expect(screen.getByText(/Nothing selected/)).toBeInTheDocument();
  });

  describe("a topic", () => {
    const topic = makeTopic({
      name: "Glycolysis",
      section: "Block 1",
      totalUnits: 100,
      completedUnits: 40,
      notes: "Skip the appendix",
    });
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });
    const selection = { kind: "topic", course, topic } as const;

    function renderTopic() {
      render(
        <Inspector
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
        "--topic-completion-color": course.color,
      });
    });

    it("passes completedUnits through untouched when something else is edited", async () => {
      // `updateTopic` takes a whole topic, so every edit resends the field.
      // Resending anything other than the current value would silently
      // overwrite progress logged in the meantime.
      const user = userEvent.setup();
      renderTopic();

      await user.click(screen.getByRole("combobox", { name: "Priority" }));
      await user.click(screen.getByRole("option", { name: "High" }));

      expect(repository.updateTopic).toHaveBeenCalledWith(
        topic.id,
        expect.objectContaining({ priority: "high", completedUnits: 40, totalUnits: 100 }),
      );
    });

    it("commits a renamed topic on blur, not on every keystroke", async () => {
      const user = userEvent.setup();
      renderTopic();

      const field = screen.getByLabelText("Name");
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

    it("reverts an edit on Escape", async () => {
      const user = userEvent.setup();
      renderTopic();

      const field = screen.getByLabelText("Name");
      await user.type(field, " and friends{Escape}");

      expect(field).toHaveValue("Glycolysis");
      expect(repository.updateTopic).not.toHaveBeenCalled();
    });

    it("does not write when the value has not changed", async () => {
      const user = userEvent.setup();
      renderTopic();

      await user.click(screen.getByLabelText("Name"));
      await user.tab();

      expect(repository.updateTopic).not.toHaveBeenCalled();
    });

    it("lets a prerequisite be added", async () => {
      const prerequisite = makeTopic({ name: "Cell biology" });
      const dependentCourse = makeCourse({ topics: [prerequisite, topic] });
      const user = userEvent.setup();
      render(
        <Inspector
          selection={{ kind: "topic", course: dependentCourse, topic }}
          health={healthFor(dependentCourse)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("checkbox", { name: "Cell biology" }));
      expect(repository.setTopicDependencies).toHaveBeenCalledWith(topic.id, [prerequisite.id]);
    });
  });

  describe("a topic with no size", () => {
    const topic = makeTopic({ name: "Reading list", totalUnits: 0 });
    const course = makeCourse({ name: "Biochemistry", topics: [topic] });

    it("offers no slider, because there is no scale to slide along", () => {
      render(
        <Inspector
          selection={{ kind: "topic", course, topic }}
          health={healthFor(course)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      expect(screen.queryByRole("slider")).not.toBeInTheDocument();
      const bar = screen.getByRole("progressbar", { name: "Reading list progress" });
      // Indeterminate, not zero: nobody has said how big this is.
      expect(bar).not.toHaveAttribute("aria-valuenow");
      expect(bar).toHaveAttribute("aria-valuetext", "Size not set");
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
          selection={{ kind: "course", course }}
          health={healthFor(course)}
          today={TODAY}
          onDelete={vi.fn()}
        />,
      );

      await user.click(screen.getByRole("radio", { name: "Violet" }));
      expect(repository.updateCourse).toHaveBeenCalledWith(
        course.id,
        expect.objectContaining({ color: "#8169d1", name: "Biochemistry" }),
      );
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
