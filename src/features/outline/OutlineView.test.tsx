import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES } from "@/domain";
import { course, exam, plan, topic } from "@/test/factories";
import { OutlineView } from "./OutlineView";

const repository = vi.hoisted(() => ({
  updateCourse: vi.fn(() => Promise.resolve()),
  reorderCourses: vi.fn(() => Promise.resolve()),
  createTopic: vi.fn(() => Promise.resolve("topic_new")),
  updateTopic: vi.fn(() => Promise.resolve()),
  deleteTopic: vi.fn(() => Promise.resolve()),
  reorderTopics: vi.fn(() => Promise.resolve()),
  logStudy: vi.fn(() => Promise.resolve()),
  createTopics: vi.fn(() => Promise.resolve([])),
  createExam: vi.fn(() => Promise.resolve("exam_new")),
  deleteExam: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerSnapshot: () => ({
    plans: [],
    studyLog: [],
    preferences: DEFAULT_PREFERENCES,
  }),
  usePlannerErrors: () => ({
    run: (action: Promise<unknown>) => void action,
    error: null,
    clear: vi.fn(),
  }),
}));

const first = topic({
  id: "topic_a",
  name: "Cell biology",
  section: "Block 1",
  totalUnits: 10,
  completedUnits: 2,
  order: 0,
});
const second = topic({
  id: "topic_b",
  name: "Membrane transport",
  section: "Block 1",
  unit: "pages",
  totalUnits: 20,
  completedUnits: 5,
  status: "active",
  order: 1,
});
const biochemistry = course({
  id: "course_1",
  name: "Biochemistry",
  exams: [exam({ startDate: "2026-08-23" })],
  topics: [first, second],
});
const semester = plan({ courses: [biochemistry] });

function renderOutline() {
  const onCreateCourse = vi.fn();
  const onSelectCourse = vi.fn();
  const onSelectTopic = vi.fn();
  render(
    <OutlineView
      plan={semester}
      course={biochemistry}
      selection={{ kind: "course", id: biochemistry.id }}
      today="2026-07-30"
      onCreateCourse={onCreateCourse}
      onSelectCourse={onSelectCourse}
      onSelectTopic={onSelectTopic}
    />,
  );
  return { onCreateCourse, onSelectCourse, onSelectTopic };
}

describe("OutlineView", () => {
  beforeEach(() => {
    for (const mock of Object.values(repository)) mock.mockClear();
    repository.createTopic.mockResolvedValue("topic_new");
  });

  it("renders the permanent seven-column editable outline grouped by section", () => {
    renderOutline();

    for (const name of ["Name", "Unit", "Total", "Done", "Progress", "Status", "Exam"]) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("textbox", { name: "Section Block 1" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-topic-row]")).toHaveLength(2);
    expect(screen.getAllByText(/24 days away/)).toHaveLength(2);
  });

  it("edits topic details inline and records Done as a study-log delta", async () => {
    const user = userEvent.setup();
    renderOutline();

    const name = screen.getByRole("textbox", { name: "Cell biology name" });
    await user.clear(name);
    await user.type(name, "Cell structure");
    await user.tab();
    expect(repository.updateTopic).toHaveBeenCalledWith("topic_a", {
      name: "Cell structure",
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Cell biology status" }),
      "active",
    );
    expect(repository.updateTopic).toHaveBeenCalledWith("topic_a", { status: "active" });

    const done = screen.getByRole("spinbutton", { name: "Cell biology done" });
    await user.clear(done);
    await user.type(done, "6");
    await user.tab();
    expect(repository.logStudy).toHaveBeenCalledWith({
      topicId: "topic_a",
      date: "2026-07-30",
      units: 4,
    });
    expect(repository.updateTopic).not.toHaveBeenCalledWith(
      "topic_a",
      expect.objectContaining({ completedUnits: expect.anything() }),
    );
  });

  it("keeps a measured topic's status and progress in sync through the study log", async () => {
    const user = userEvent.setup();
    renderOutline();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Membrane transport status" }),
      "done",
    );
    expect(repository.logStudy).toHaveBeenCalledWith({
      topicId: "topic_b",
      date: "2026-07-30",
      units: 15,
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Membrane transport status" }),
      "planned",
    );
    expect(repository.logStudy).toHaveBeenCalledWith({
      topicId: "topic_b",
      date: "2026-07-30",
      units: -5,
    });
  });

  it("opens an inline row with Command-Enter and inserts the new topic in place", async () => {
    const user = userEvent.setup();
    renderOutline();

    const name = screen.getByRole("textbox", { name: "Cell biology name" });
    name.focus();
    await user.keyboard("{Control>}{Enter}{/Control}");
    const newName = screen.getByRole("textbox", { name: "New topic name" });
    await user.type(newName, "Cell signalling{Enter}");

    expect(repository.createTopic).toHaveBeenCalledWith("course_1", {
      name: "Cell signalling",
      section: "Block 1",
      unit: "slides",
      totalUnits: 0,
      color: biochemistry.color,
    });
    await waitFor(() =>
      expect(repository.reorderTopics).toHaveBeenCalledWith("course_1", [
        "topic_a",
        "topic_new",
        "topic_b",
      ]),
    );
  });

  it("reorders topics by dragging the handle onto another row", async () => {
    renderOutline();
    const dataTransfer = {
      effectAllowed: "none",
      setData: vi.fn(),
      getData: vi.fn(),
    };

    fireEvent.dragStart(screen.getByRole("button", { name: "Drag Membrane transport" }), {
      dataTransfer,
    });
    const target = screen.getByRole("textbox", { name: "Cell biology name" }).closest("tr");
    expect(target).not.toBeNull();
    fireEvent.dragOver(target!);
    fireEvent.drop(target!);

    await waitFor(() =>
      expect(repository.reorderTopics).toHaveBeenCalledWith("course_1", [
        "topic_b",
        "topic_a",
      ]),
    );
  });

  it("creates a course directly from the outline course strip", async () => {
    const user = userEvent.setup();
    const { onCreateCourse } = renderOutline();

    await user.click(screen.getByRole("button", { name: "Add course" }));
    const form = screen.getByRole("button", { name: "Add" }).closest("form");
    expect(form).not.toBeNull();
    await user.type(within(form!).getByRole("textbox", { name: "Course name" }), "Physiology");
    await user.click(within(form!).getByRole("button", { name: "Add" }));

    expect(onCreateCourse).toHaveBeenCalledWith("Physiology");
  });
});
