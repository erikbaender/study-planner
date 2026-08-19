import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  course as makeCourse,
  exam as makeExam,
  snapshot as makeSnapshot,
  topic as makeTopic,
} from "@/test/factories";
import type { CourseHealth } from "@/domain";
import { useWorkspace } from "@/features/workspace/store";
import { OutlineView } from "./outline-view";
import { TOPIC_ROW_HEIGHT, TopicList } from "./topic-list";

const repository = {
  updateTopic: vi.fn(() => Promise.resolve()),
  logStudy: vi.fn(() => Promise.resolve()),
};

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerRun: () => vi.fn(),
  usePlannerErrors: () => ({ run: vi.fn(), error: null, clear: () => {} }),
}));

const TODAY = "2026-05-01";
const topics = [
  makeTopic({ name: "Krebs cycle", totalUnits: 50 }),
  makeTopic({ name: "Glycolysis", totalUnits: 100, completedUnits: 40 }),
];
const course = makeCourse({ name: "Biochemistry", topics });

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ collapsedCourseIds: [], selection: null, courseSort: "name" });
});

function renderList({
  selectedId = null,
  onSelect = vi.fn(),
  onDelete = vi.fn(),
}: {
  selectedId?: string | null;
  onSelect?: (topic: typeof topics[number]) => void;
  onDelete?: (topic: typeof topics[number]) => void;
} = {}) {
  render(
    <TopicList
      courseId={course.id}
      tint="#8169d1"
      topics={topics}
      today={TODAY}
      selectedId={selectedId}
      onSelect={onSelect}
      onDelete={onDelete}
    />,
  );
  return { onSelect, onDelete };
}

describe("TopicList", () => {
  it("selects the topic represented by a row when its select button is clicked", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList();

    await user.click(screen.getByRole("button", { name: "Select Glycolysis" }));

    expect(onSelect).toHaveBeenCalledWith(topics[1]);
  });

  it("does not select a topic when its context menu opens", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderList();

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Glycolysis") });

    expect(useWorkspace.getState().selection).toBeNull();
    expect(screen.getByText("Glycolysis").closest(".topic-completion-row")).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(screen.queryByRole("button", { name: "Delete Glycolysis" })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(topics[1]);
  });

  it("renders course topics in repository order", () => {
    render(
      <OutlineView
        courses={[course]}
        health={new Map()}
        today={TODAY}
        query=""
        snapshot={makeSnapshot()}
        selectedId={null}
        onSelectTopic={vi.fn()}
        onSelectExam={vi.fn()}
        onDeleteExam={vi.fn()}
        onSelectCourse={vi.fn()}
        onDeleteTopic={vi.fn()}
        onDeleteCourse={vi.fn()}
        onEditCourse={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    expect(
      within(screen.getByRole("list"))
        .getAllByRole("button", { name: /^Select / })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Select Krebs cycle", "Select Glycolysis"]);
  });

  it("restacks the cards when the sort control changes the order", async () => {
    const user = userEvent.setup();
    const anatomy = makeCourse({ name: "Anatomy", exams: [] });
    const physiology = makeCourse({
      name: "Physiology",
      exams: [makeExam({ startDate: "2026-06-01" })],
    });

    render(
      <OutlineView
        courses={[anatomy, physiology]}
        health={new Map()}
        today={TODAY}
        query=""
        snapshot={makeSnapshot()}
        selectedId={null}
        onSelectTopic={vi.fn()}
        onSelectExam={vi.fn()}
        onDeleteExam={vi.fn()}
        onSelectCourse={vi.fn()}
        onDeleteTopic={vi.fn()}
        onDeleteCourse={vi.fn()}
        onEditCourse={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    const order = () =>
      Array.from(document.querySelectorAll("section[data-course-id]")).map((card) =>
        card.getAttribute("data-course-id"),
      );

    expect(order()).toEqual([anatomy.id, physiology.id]);

    await user.click(screen.getByRole("radio", { name: "Chronological" }));

    // The course with an exam to sit comes first; the one without follows.
    expect(order()).toEqual([physiology.id, anatomy.id]);
  });

  it("marks the selected topic row as pressed so the current selection is visible", () => {
    renderList({ selectedId: topics[0].id });

    expect(screen.getByRole("button", { name: "Select Krebs cycle" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Select Glycolysis" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders one row per topic and nothing else", () => {
    // Adding a topic is the section header's button, which opens the form. A
    // second affordance shaped like a row was a different way of adding a
    // different kind of topic — an unnamed one.
    renderList();

    expect(screen.getAllByRole("listitem")).toHaveLength(topics.length);
    expect(screen.getAllByRole("button", { name: /^Select / })).toHaveLength(topics.length);
  });

  it("warns on a topic whose scheduled window has closed with work left", () => {
    const overdue = makeTopic({
      name: "Lipids",
      totalUnits: 20,
      blocks: [
        {
          id: "block_overdue",
          topicId: "topic_overdue",
          startDate: "2026-04-20",
          endDate: "2026-04-25",
          source: "auto" as const,
        },
      ],
    });
    render(
      <TopicList
        courseId="course_1"
        tint="#8169d1"
        topics={[overdue]}
        today={TODAY}
        selectedId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("img", { name: "Lipids has overdue work" })).toBeInTheDocument();
  });

  it("keeps each transitioning slot fixed while the visible row is inset", () => {
    renderList();

    const topicSlot = screen
      .getAllByRole("listitem")
      .find((item) => item.querySelector(".topic-completion-row"));

    expect(topicSlot).toHaveStyle({ height: `${TOPIC_ROW_HEIGHT}px` });
    expect(topicSlot).toHaveClass("p-[3px]");
    expect(topicSlot?.querySelector(".topic-completion-row")).toHaveStyle({ height: "28px" });
  });
});


describe("OutlineView course selection", () => {
  const courses = [
    makeCourse({ id: "course_1", name: "Biochemistry" }),
    makeCourse({ id: "course_2", name: "Anatomy" }),
  ];

  function renderOutline() {
    return render(
      <OutlineView
        courses={courses}
        health={new Map()}
        today={TODAY}
        query=""
        snapshot={makeSnapshot()}
        selectedId={null}
        onSelectTopic={vi.fn()}
        onSelectExam={vi.fn()}
        onDeleteExam={vi.fn()}
        onSelectCourse={(selectedCourse, selected) =>
          useWorkspace
            .getState()
            .select(selected ? { kind: "course", id: selectedCourse.id } : null)
        }
        onDeleteTopic={vi.fn()}
        onDeleteCourse={vi.fn()}
        onEditCourse={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );
  }

  const label = (name: string) => screen.getByRole("button", { name: `Select ${name}` });

  it("folds a card without selecting the course", async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.click(screen.getByRole("button", { name: "Collapse Biochemistry" }));

    expect(screen.getByRole("button", { name: "Expand Biochemistry" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(useWorkspace.getState().selection).toBeNull();
    expect(label("Biochemistry")).not.toHaveAttribute("data-selection");
  });

  it("selects a course from its name without folding anything", async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.click(label("Biochemistry"));

    expect(useWorkspace.getState().selection).toEqual({ kind: "course", id: "course_1" });
    expect(label("Biochemistry")).toHaveAttribute("data-selection", "primary");
    expect(label("Biochemistry")).toHaveAttribute("aria-pressed", "true");
    // Both cards are exactly as folded as they were before the click.
    expect(screen.getByRole("button", { name: "Collapse Biochemistry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Anatomy" })).toBeInTheDocument();
  });

  it("preserves a folded course across outline remounts", async () => {
    const user = userEvent.setup();
    const first = renderOutline();
    await user.click(screen.getByRole("button", { name: "Collapse Biochemistry" }));
    first.unmount();

    renderOutline();

    expect(screen.getByRole("button", { name: "Expand Biochemistry" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Collapse Anatomy" })).toBeInTheDocument();
  });

  it("folds and unfolds every visible course from the outline toolbar", async () => {
    const user = userEvent.setup();
    renderOutline();

    const foldAll = screen.getByRole("button", { name: "Fold all courses" });
    const unfoldAll = screen.getByRole("button", { name: "Unfold all courses" });
    expect(foldAll).toBeEnabled();
    expect(unfoldAll).toBeDisabled();

    await user.click(foldAll);

    expect(screen.getByRole("button", { name: "Expand Biochemistry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand Anatomy" })).toBeInTheDocument();
    expect(foldAll).toBeDisabled();
    expect(unfoldAll).toBeEnabled();

    await user.click(unfoldAll);

    expect(screen.getByRole("button", { name: "Collapse Biochemistry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Anatomy" })).toBeInTheDocument();
  });

  it("consumes a sidebar reveal only after its course card mounts", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    useWorkspace.setState({ view: "today", collapsedCourseIds: ["course_2"] });
    useWorkspace.getState().revealCourse("course_2");

    renderOutline();

    expect(screen.getByRole("button", { name: "Collapse Anatomy" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(useWorkspace.getState().revealCourseId).toBeNull();
  });

  it("treats a course as done when all of its sized topics are done", () => {
    const mixed = makeCourse({
      id: "course_mixed",
      name: "Physiology",
      topics: [
        makeTopic({ totalUnits: 10, completedUnits: 10 }),
        makeTopic({ totalUnits: 0, completedUnits: 0 }),
      ],
    });

    render(
      <OutlineView
        courses={[mixed]}
        health={new Map()}
        today={TODAY}
        query=""
        snapshot={makeSnapshot()}
        selectedId={null}
        onSelectTopic={vi.fn()}
        onSelectExam={vi.fn()}
        onDeleteExam={vi.fn()}
        onSelectCourse={vi.fn()}
        onDeleteTopic={vi.fn()}
        onDeleteCourse={vi.fn()}
        onEditCourse={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Mark Physiology as done" })).toBeChecked();
  });

  it("lets a course go when its name is clicked a second time", async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.click(label("Biochemistry"));
    await user.click(label("Biochemistry"));

    expect(useWorkspace.getState().selection).toBeNull();
    expect(label("Biochemistry")).not.toHaveAttribute("data-selection");
  });

  it("extends the selection with Shift and keeps the last course primary", async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.click(label("Biochemistry"));
    await user.keyboard("{Shift>}");
    await user.click(label("Anatomy"));
    await user.keyboard("{/Shift}");

    expect(label("Biochemistry")).toHaveAttribute("data-selection", "secondary");
    expect(label("Anatomy")).toHaveAttribute("data-selection", "primary");
  });

  it("subtracts a course with Ctrl without disturbing the remaining primary", async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.click(label("Biochemistry"));
    await user.keyboard("{Shift>}");
    await user.click(label("Anatomy"));
    await user.keyboard("{/Shift}");
    await user.keyboard("{Control>}");
    await user.click(label("Anatomy"));
    await user.keyboard("{/Control}");

    expect(label("Anatomy")).not.toHaveAttribute("data-selection");
    expect(label("Biochemistry")).toHaveAttribute("data-selection", "primary");
  });

  it("treats Shift with no prior selection as a normal single selection", async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.keyboard("{Shift>}");
    await user.click(label("Biochemistry"));
    await user.keyboard("{/Shift}");

    expect(label("Biochemistry")).toHaveAttribute("data-selection", "primary");
    expect(label("Anatomy")).not.toHaveAttribute("data-selection");
  });

  it("replaces a multi-selection on a regular click", async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.click(label("Biochemistry"));
    await user.keyboard("{Shift>}");
    await user.click(label("Anatomy"));
    await user.keyboard("{/Shift}");
    await user.click(label("Biochemistry"));

    expect(label("Biochemistry")).toHaveAttribute("data-selection", "primary");
    expect(label("Anatomy")).not.toHaveAttribute("data-selection");
  });

  it("routes exam context-menu deletion through the confirmation callback", async () => {
    const user = userEvent.setup();
    const exam = makeExam({ name: "Final exam" });
    const course = makeCourse({ name: "Biochemistry", exams: [exam] });
    const onDeleteExam = vi.fn();

    render(
      <OutlineView
        courses={[course]}
        health={new Map()}
        today={TODAY}
        query=""
        snapshot={makeSnapshot()}
        selectedId={null}
        onSelectTopic={vi.fn()}
        onSelectExam={vi.fn()}
        onDeleteExam={onDeleteExam}
        onSelectCourse={vi.fn()}
        onDeleteTopic={vi.fn()}
        onDeleteCourse={vi.fn()}
        onEditCourse={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("Final exam") });
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    expect(onDeleteExam).toHaveBeenCalledWith(course, exam);
  });

  it("keeps status labels concise and exam timing in metadata", () => {
    const atRiskCourse = makeCourse({
      name: "Biochemistry",
      exams: [makeExam({ startDate: "2026-05-08" })],
      topics: [
        makeTopic({
          id: "topic_at_risk",
          totalUnits: 10,
          blocks: [
            {
              id: "block_1",
              topicId: "topic_at_risk",
              startDate: "2026-04-30",
              endDate: "2026-04-30",
              plannedUnits: 2,
              source: "auto",
            },
          ],
        }),
      ],
    });
    const courseHealth: CourseHealth = {
      courseId: atRiskCourse.id,
      progress: { completedUnits: 0, totalUnits: 10, remainingUnits: 10, ratio: 0 },
      exam: atRiskCourse.exams[0],
      daysUntilExam: 7,
      pace: {
        remainingUnits: 10,
        studyDaysLeft: 5,
        requiredPace: 2,
        actualVelocity: 1,
        projectedFinish: "2026-05-11",
        onTrack: false,
        daysLate: 3,
      },
    };

    render(
      <OutlineView
        courses={[atRiskCourse]}
        health={new Map([[atRiskCourse.id, courseHealth]])}
        today={TODAY}
        query=""
        snapshot={makeSnapshot()}
        selectedId={null}
        onSelectTopic={vi.fn()}
        onSelectExam={vi.fn()}
        onDeleteExam={vi.fn()}
        onSelectCourse={vi.fn()}
        onDeleteTopic={vi.fn()}
        onDeleteCourse={vi.fn()}
        onEditCourse={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    const status = screen.getByLabelText("Biochemistry status");
    expect(status).toHaveClass("flex-wrap");
    expect(within(status).getByText("3 days behind")).toHaveClass("text-warning");
    expect(within(status).getByText("1 overdue")).toHaveClass("text-negative");
    expect(within(status).queryByText(/pace|work/i)).not.toBeInTheDocument();
    expect(within(status).queryByText(/exam/i)).not.toBeInTheDocument();
    expect(screen.getByText("7 days").closest(".text-tertiary")).toHaveTextContent(
      /1 topic.*·.*7 days/,
    );
    expect(screen.getByRole("button", { name: "Select Biochemistry" }).closest(".outline-card-header"))
      .toHaveClass("p-3");
    expect(screen.getByRole("button", { name: "Select Biochemistry" })).not.toContainElement(
      status,
    );
  });

  it("labels an off-track course without a projected finish as unknown", () => {
    const stalledCourse = makeCourse({
      name: "Pathology",
      exams: [makeExam({ startDate: "2026-05-08" })],
      topics: [makeTopic({ totalUnits: 10 })],
    });
    const stalledHealth: CourseHealth = {
      courseId: stalledCourse.id,
      progress: { completedUnits: 0, totalUnits: 10, remainingUnits: 10, ratio: 0 },
      exam: stalledCourse.exams[0],
      daysUntilExam: 7,
      pace: {
        remainingUnits: 10,
        studyDaysLeft: 5,
        requiredPace: 2,
        actualVelocity: 0,
        projectedFinish: null,
        onTrack: false,
        daysLate: 0,
      },
    };

    render(
      <OutlineView
        courses={[stalledCourse]}
        health={new Map([[stalledCourse.id, stalledHealth]])}
        today={TODAY}
        query=""
        snapshot={makeSnapshot()}
        selectedId={null}
        onSelectTopic={vi.fn()}
        onSelectExam={vi.fn()}
        onDeleteExam={vi.fn()}
        onSelectCourse={vi.fn()}
        onDeleteTopic={vi.fn()}
        onDeleteCourse={vi.fn()}
        onEditCourse={vi.fn()}
        onNewCourse={vi.fn()}
      />,
    );

    const status = screen.getByLabelText("Pathology status");
    expect(within(status).getByText("Finish unknown")).toHaveClass("text-warning");
    expect(within(status).queryByText("0 days behind")).not.toBeInTheDocument();
  });
});
