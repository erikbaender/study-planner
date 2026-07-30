import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, type PlannerSnapshot } from "@/domain";
import { course, exam, plan, topic } from "@/test/factories";
import { TooltipProvider } from "@/ui";
import { InspectorPane } from "./InspectorPane";

const TODAY = "2026-07-30";
const glycolysis = topic({
  id: "topic_glycolysis",
  courseId: "course_bio",
  name: "Glycolysis",
  totalUnits: 100,
  completedUnits: 40,
});
const biochemistry = course({
  id: "course_bio",
  name: "Biochemistry",
  exams: [exam({ startDate: "2026-08-20" })],
  topics: [glycolysis],
});
const semester = plan({ courses: [biochemistry] });
const snapshot: PlannerSnapshot = {
  plans: [semester],
  preferences: { ...DEFAULT_PREFERENCES, dailyCapacityUnits: 40 },
  studyLog: [
    {
      id: "log_1",
      topicId: glycolysis.id,
      date: TODAY,
      units: 20,
      minutes: 30,
    },
  ],
};

describe("InspectorPane", () => {
  it("shows shared velocity and projection detail for a selected course", () => {
    render(
      <TooltipProvider>
        <InspectorPane
          plan={semester}
          snapshot={snapshot}
          selection={{ kind: "course", id: biochemistry.id }}
          today={TODAY}
          onClose={vi.fn()}
          onLogStudy={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: "Pace and projection" })).toBeInTheDocument();
    expect(screen.getByText("Observed pace")).toBeInTheDocument();
    expect(screen.getByText("Needed pace")).toBeInTheDocument();
    expect(screen.getByText("Projected finish")).toBeInTheDocument();
    expect(screen.getByText("Study days left")).toBeInTheDocument();
  });

  it("shows the selected topic's study history", () => {
    render(
      <TooltipProvider>
        <InspectorPane
          plan={semester}
          snapshot={snapshot}
          selection={{ kind: "topic", id: glycolysis.id }}
          today={TODAY}
          onClose={vi.fn()}
          onLogStudy={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("heading", { name: "Study history" })).toBeInTheDocument();
    expect(screen.getByText("30 min")).toBeInTheDocument();
    expect(screen.getByText(/\+20 slides/)).toBeInTheDocument();
  });
});
