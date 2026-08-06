import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assessCourse,
  DEFAULT_PREFERENCES,
  EMPTY_SNAPSHOT,
  type Course,
  type CourseHealth,
} from "@/domain";
import { course as makeCourse, exam as makeExam, topic as makeTopic } from "@/test/factories";
import { TodayView } from "./today-view";

const repository = { logStudy: vi.fn(() => Promise.resolve()) };
const run = vi.fn();

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerErrors: () => ({ run, error: null, clear: () => {} }),
}));

const TODAY = "2026-05-01";

beforeEach(() => {
  vi.clearAllMocks();
});

function healthOf(courses: readonly Course[]): Map<string, CourseHealth> {
  return new Map(
    courses.map((course) => [
      course.id,
      assessCourse({ course, today: TODAY, calendar: DEFAULT_PREFERENCES, log: [] }),
    ]),
  );
}

function renderToday(
  courses: readonly Course[],
  studyLog: Parameters<typeof TodayView>[0]["studyLog"] = [],
) {
  render(
    <TodayView
      courses={courses}
      health={healthOf(courses)}
      studyLog={studyLog}
      snapshot={{ ...EMPTY_SNAPSHOT, studyLog: [...studyLog] }}
      today={TODAY}
      selectedTopicId={null}
      onSelectTopic={vi.fn()}
      onDeleteTopic={vi.fn()}
      onGoToOutline={vi.fn()}
    />,
  );
}

function card(name: string) {
  return screen.getByRole("heading", { name }).closest("section")!;
}

describe("TodayView", () => {
  it("does not report a zero when nothing has been logged yet", () => {
    // "0 units logged" reads as a verdict on a day that is not over.
    renderToday([makeCourse({ topics: [makeTopic({ totalUnits: 10 })] })]);
    expect(screen.getByText("Nothing logged yet today")).toBeInTheDocument();
  });

  it("counts only today's entries", () => {
    const topic = makeTopic({ totalUnits: 100, completedUnits: 30 });
    renderToday(
      [makeCourse({ topics: [topic] })],
      [
        { id: "a", topicId: topic.id, date: TODAY, units: 12 },
        { id: "b", topicId: topic.id, date: TODAY, units: 8 },
        { id: "c", topicId: topic.id, date: "2026-04-30", units: 99 },
      ],
    );
    expect(screen.getByText("20 units logged today")).toBeInTheDocument();
  });

  it("lists the next three exams, soonest first", () => {
    const courses = [
      makeCourse({ name: "A", exams: [makeExam({ name: "A exam", startDate: "2026-06-01" })] }),
      makeCourse({ name: "B", exams: [makeExam({ name: "B exam", startDate: "2026-05-03" })] }),
      makeCourse({ name: "C", exams: [makeExam({ name: "C exam", startDate: "2026-05-20" })] }),
      makeCourse({ name: "D", exams: [makeExam({ name: "D exam", startDate: "2026-07-01" })] }),
    ];
    renderToday(courses);

    const rows = within(card("Coming up")).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("B exam"),
      expect.stringContaining("C exam"),
      expect.stringContaining("A exam"),
    ]);
    // The July one falls off the end rather than being squeezed in.
    expect(screen.queryByText(/D exam/)).not.toBeInTheDocument();
  });

  it("offers part-finished topics before untouched ones", () => {
    // Finishing something in flight beats opening something new.
    const course = makeCourse({
      name: "Biochem",
      topics: [
        makeTopic({ name: "Untouched", totalUnits: 100, completedUnits: 0, order: 0 }),
        makeTopic({ name: "Started", totalUnits: 100, completedUnits: 60, order: 1 }),
      ],
    });
    renderToday([course]);

    const rows = within(card("Pick up where you left off")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Started");
    expect(rows[1]).toHaveTextContent("Untouched");
  });

  it("puts the course with the nearer exam first", () => {
    const soon = makeCourse({
      name: "Soon",
      topics: [makeTopic({ name: "Soon topic", totalUnits: 100, completedUnits: 10 })],
      exams: [makeExam({ startDate: "2026-05-05" })],
    });
    const later = makeCourse({
      name: "Later",
      topics: [makeTopic({ name: "Later topic", totalUnits: 100, completedUnits: 10 })],
      exams: [makeExam({ startDate: "2026-09-05" })],
    });
    renderToday([later, soon]);

    const rows = within(card("Pick up where you left off")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Soon topic");
  });

  it("leaves out finished and unsized topics", () => {
    // A finished topic is not something to pick up; an unsized one has no bar
    // to move, so offering it would be offering a control that does nothing.
    const course = makeCourse({
      topics: [
        makeTopic({ name: "Finished", totalUnits: 50, completedUnits: 50, status: "done" }),
        makeTopic({ name: "Unsized", totalUnits: 0 }),
        makeTopic({ name: "Live", totalUnits: 50, completedUnits: 5 }),
      ],
    });
    renderToday([course]);

    const rows = within(card("Pick up where you left off")).getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Live");
  });

  it("logs the difference when a bar is dragged from here", async () => {
    const topic = makeTopic({ name: "Glycolysis", totalUnits: 100, completedUnits: 40 });
    const user = userEvent.setup();
    renderToday([makeCourse({ topics: [topic] })]);

    await user.click(screen.getByRole("slider", { name: "Glycolysis progress" }));
    await user.keyboard("{ArrowRight}");

    expect(repository.logStudy).toHaveBeenCalledWith({
      topicId: topic.id,
      date: TODAY,
      units: 1,
    });
  });

  it("shows the behind card only when something is behind", () => {
    const fine = makeCourse({ topics: [makeTopic({ totalUnits: 10, completedUnits: 10 })] });
    renderToday([fine]);
    expect(screen.queryByRole("heading", { name: "Behind" })).not.toBeInTheDocument();

    const doomed = makeCourse({
      name: "Doomed",
      topics: [makeTopic({ totalUnits: 5000 })],
      exams: [makeExam({ startDate: "2026-05-04" })],
    });
    renderToday([doomed]);
    expect(within(card("Behind")).getByText("Doomed")).toBeInTheDocument();
  });

  it("says there are no dates rather than showing an empty exam list", () => {
    renderToday([makeCourse({ topics: [makeTopic({ totalUnits: 10 })], exams: [] })]);
    expect(within(card("Coming up")).getByText(/No exam dates/)).toBeInTheDocument();
  });

  it("offers a way out when the focus holds nothing", () => {
    const onGoToOutline = vi.fn();
    render(
      <TodayView
        courses={[]}
        health={new Map()}
        studyLog={[]}
        snapshot={EMPTY_SNAPSHOT}
        today={TODAY}
        selectedTopicId={null}
        onSelectTopic={vi.fn()}
        onDeleteTopic={vi.fn()}
        onGoToOutline={onGoToOutline}
      />,
    );
    expect(screen.getByRole("heading", { name: "Nothing in focus" })).toBeInTheDocument();
  });
});
