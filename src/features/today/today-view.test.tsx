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

const repository = {
  logStudy: vi.fn(() => Promise.resolve()),
  deleteStudyBlock: vi.fn(() => Promise.resolve()),
};
const run = vi.fn();

vi.mock("@/data/use-repository", () => ({
  useRepository: () => repository,
  usePlannerRun: () => run,
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
  selectedBlockId: string | null = null,
  onSelectBlock = vi.fn(),
) {
  render(
    <TodayView
      courses={courses}
      health={healthOf(courses)}
      studyLog={studyLog}
      snapshot={{ ...EMPTY_SNAPSHOT, studyLog: [...studyLog] }}
      today={TODAY}
      selectedBlockId={selectedBlockId}
      onSelectBlock={onSelectBlock}
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

  it("lists today's work one row per scheduled block", () => {
    // The plan is made of dated blocks now. A topic can therefore appear more
    // than once, because each occurrence is a separate piece of work to open.
    const course = makeCourse({
      name: "Biochem",
      topics: [
        makeTopic({
          name: "Glycolysis",
          blocks: [
            { id: "block_morning", topicId: "topic_morning", startDate: TODAY, endDate: TODAY, plannedUnits: 12, source: "auto" },
            { id: "block_afternoon", topicId: "topic_morning", startDate: TODAY, endDate: TODAY, plannedUnits: 8, source: "manual" },
          ],
        }),
      ],
    });
    renderToday([course]);

    const rows = within(card("Today’s plan")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("12 today · Glycolysis");
    expect(rows[1]).toHaveTextContent("8 today · Glycolysis");
    expect(within(rows[0]).getByRole("button", { name: "Remove Glycolysis from today" })).toBeInTheDocument();
  });

  it("selects a block row rather than its parent topic", async () => {
    const block = {
      id: "block_selected",
      topicId: "topic_selected",
      startDate: TODAY,
      endDate: TODAY,
      plannedUnits: 10,
      source: "manual" as const,
    };
    const topic = makeTopic({ id: "topic_selected", name: "Glycolysis", blocks: [block] });
    const onSelectBlock = vi.fn();
    renderToday([makeCourse({ name: "Biochem", topics: [topic] })], [], null, onSelectBlock);

    await userEvent.setup().click(
      within(card("Today’s plan")).getByRole("button", { name: /Biochem.*10 today.*Glycolysis/ }),
    );
    expect(onSelectBlock).toHaveBeenCalledWith(block);
  });

  it("does not invent Today's rows for topics without a block covering today", () => {
    const course = makeCourse({
      topics: [
        makeTopic({ name: "Finished", totalUnits: 50, completedUnits: 50 }),
        makeTopic({ name: "Unsized", totalUnits: 0 }),
        makeTopic({
          name: "Live",
          totalUnits: 50,
          completedUnits: 5,
          blocks: [{ id: "block_future", topicId: "topic_future", startDate: "2026-05-03", endDate: "2026-05-04", source: "auto" }],
        }),
      ],
    });
    renderToday([course]);

    expect(within(card("Today’s plan")).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("logs the difference when a bar is dragged from here", async () => {
    const topic = makeTopic({
      name: "Glycolysis",
      totalUnits: 100,
      completedUnits: 40,
      blocks: [{ id: "block_progress", topicId: "topic_progress", startDate: TODAY, endDate: TODAY, source: "auto" }],
    });
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

  it("shows a slipping course's health beside its upcoming exam", () => {
    const doomed = makeCourse({
      name: "Doomed",
      topics: [makeTopic({ totalUnits: 5000 })],
      exams: [makeExam({ startDate: "2026-05-04" })],
    });
    renderToday([doomed]);
    const examRow = within(card("Coming up")).getByRole("listitem");
    expect(examRow).toHaveTextContent("Doomed");
    expect(examRow).toHaveTextContent("Behind");
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
        selectedBlockId={null}
        onSelectBlock={vi.fn()}
        onGoToOutline={onGoToOutline}
      />,
    );
    expect(screen.getByRole("heading", { name: "Nothing in focus" })).toBeInTheDocument();
  });
});
