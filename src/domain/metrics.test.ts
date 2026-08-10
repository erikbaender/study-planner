import { describe, expect, it } from "vitest";
import { course, exam, topic } from "@/test/factories";
import type { StudyCalendar } from "./dates";
import {
  assessCourse,
  assessPace,
  courseProgress,
  daysUntil,
  effectiveDeadline,
  nextExam,
  progressOf,
  projectFinishDate,
  topicStatus,
  velocity,
  velocityForTopics,
} from "./metrics";
import type { StudyLogEntry } from "./types";

/** Wednesday. Every date below is chosen relative to it. */
const TODAY = "2026-07-29";

const WEEKDAYS_ONLY: StudyCalendar = {
  studyDaysOfWeek: [1, 2, 3, 4, 5],
  blackoutDates: [],
};

const log = (entries: Array<Partial<StudyLogEntry> & { date: string; units: number }>) =>
  entries.map((entry, index) => ({
    id: `log_${index}`,
    topicId: "topic_1",
    ...entry,
  }));

describe("topicStatus", () => {
  it("is planned before anything is logged", () => {
    expect(topicStatus(topic({ totalUnits: 100, completedUnits: 0 }))).toBe("planned");
  });

  it("is active once some units are logged", () => {
    expect(topicStatus(topic({ totalUnits: 100, completedUnits: 40 }))).toBe("active");
  });

  it("is done once completed reaches the total", () => {
    expect(topicStatus(topic({ totalUnits: 100, completedUnits: 100 }))).toBe("done");
  });

  it("never reports done for a size-untracked topic, however much is logged", () => {
    // `totalUnits === 0` has no total to compare against — the topic reads as
    // active at best, never done, regardless of completedUnits.
    expect(topicStatus(topic({ totalUnits: 0, completedUnits: 0 }))).toBe("planned");
    expect(topicStatus(topic({ totalUnits: 0, completedUnits: 40 }))).toBe("active");
  });
});

describe("progressOf", () => {
  it("sums only topics whose size is tracked", () => {
    // A topic with `totalUnits === 0` is unmeasured, not complete — folding it
    // in either direction would misreport the course.
    expect(
      progressOf([
        topic({ totalUnits: 100, completedUnits: 25 }),
        topic({ totalUnits: 0, completedUnits: 0 }),
        topic({ totalUnits: 50, completedUnits: 50 }),
      ]),
    ).toEqual({ totalUnits: 150, completedUnits: 75, remainingUnits: 75, ratio: 0.5 });
  });

  it("clamps an over-logged topic rather than reporting above 100%", () => {
    expect(progressOf([topic({ totalUnits: 100, completedUnits: 130 })])).toEqual({
      totalUnits: 100,
      completedUnits: 100,
      remainingUnits: 0,
      ratio: 1,
    });
  });

  it("reports a null ratio when nothing is measured", () => {
    // Distinct from 0: "we cannot say" is not "you have done none of it".
    expect(progressOf([topic({ totalUnits: 0 })]).ratio).toBeNull();
    expect(progressOf([]).ratio).toBeNull();
  });

  it("rolls up through a course", () => {
    const subject = course({
      topics: [topic({ totalUnits: 40, completedUnits: 10 }), topic({ totalUnits: 60 })],
    });
    expect(courseProgress(subject).ratio).toBeCloseTo(0.1);
  });
});

describe("nextExam", () => {
  it("picks the earliest exam that has not happened", () => {
    const subject = course({
      exams: [
        exam({ id: "late", startDate: "2026-09-01" }),
        exam({ id: "past", startDate: "2026-07-01" }),
        exam({ id: "soon", startDate: "2026-08-10" }),
      ],
    });
    expect(nextExam(subject, TODAY)?.id).toBe("soon");
  });

  it("counts an exam happening today", () => {
    const subject = course({ exams: [exam({ id: "now", startDate: TODAY })] });
    expect(nextExam(subject, TODAY)?.id).toBe("now");
  });

  it("returns null once every exam is behind", () => {
    expect(nextExam(course({ exams: [exam({ startDate: "2026-07-01" })] }), TODAY)).toBeNull();
  });

  it("uses the start of a provisional window as the deadline", () => {
    // Planning for the far end of an announced window is how you turn up
    // unprepared on the day it actually lands.
    const provisional = exam({
      startDate: "2026-08-10",
      endDate: "2026-08-17",
      status: "provisional",
    });
    expect(effectiveDeadline(provisional)).toBe("2026-08-10");
  });

  it("counts days forward to a date", () => {
    expect(daysUntil("2026-08-05", TODAY)).toBe(7);
    expect(daysUntil("2026-07-24", TODAY)).toBe(-5);
  });
});

describe("velocity", () => {
  it("averages over available study days, not calendar days", () => {
    // The trailing window is 23–29 July, which contains five weekdays. Dividing
    // by seven would punish someone for taking their scheduled days off.
    const entries = log([
      { date: "2026-07-27", units: 50 },
      { date: "2026-07-28", units: 50 },
    ]);
    expect(velocity(entries, TODAY, WEEKDAYS_ONLY)).toBe(20);
  });

  it("ignores entries outside the window", () => {
    const entries = log([
      { date: "2026-07-22", units: 500 },
      { date: "2026-07-27", units: 50 },
    ]);
    expect(velocity(entries, TODAY, WEEKDAYS_ONLY)).toBe(10);
  });

  it("is zero when the window contains no study days", () => {
    const never: StudyCalendar = { studyDaysOfWeek: [], blackoutDates: [] };
    expect(velocity(log([{ date: TODAY, units: 100 }]), TODAY, never)).toBe(0);
  });

  it("restricts to the topics asked for", () => {
    const entries = [
      ...log([{ date: "2026-07-27", units: 100 }]),
      { id: "other", topicId: "topic_2", date: "2026-07-28", units: 900 },
    ];
    expect(velocityForTopics(entries, new Set(["topic_1"]), TODAY, WEEKDAYS_ONLY)).toBe(20);
  });
});

describe("projectFinishDate", () => {
  it("walks forward over study days only", () => {
    // 100 units at 20/day is five study days: Wed–Fri, then Mon and Tue, since
    // the weekend is not available. Dividing would have said Sunday.
    expect(
      projectFinishDate({
        remainingUnits: 100,
        today: TODAY,
        calendar: WEEKDAYS_ONLY,
        unitsPerDay: 20,
      }),
    ).toBe("2026-08-04");
  });

  it("is today when there is nothing left", () => {
    expect(
      projectFinishDate({
        remainingUnits: 0,
        today: TODAY,
        calendar: WEEKDAYS_ONLY,
        unitsPerDay: 20,
      }),
    ).toBe(TODAY);
  });

  it("is null when there is no forward progress to extrapolate", () => {
    expect(
      projectFinishDate({
        remainingUnits: 100,
        today: TODAY,
        calendar: WEEKDAYS_ONLY,
        unitsPerDay: 0,
      }),
    ).toBeNull();
  });

  it("gives up rather than walking forever at a hopeless pace", () => {
    expect(
      projectFinishDate({
        remainingUnits: 1_000_000,
        today: TODAY,
        calendar: WEEKDAYS_ONLY,
        unitsPerDay: 0.001,
        maxDays: 30,
      }),
    ).toBeNull();
  });
});

describe("assessPace", () => {
  const base = {
    today: TODAY,
    calendar: WEEKDAYS_ONLY,
  };

  it("is on track when the required pace is within the observed one", () => {
    const result = assessPace({
      ...base,
      remainingUnits: 100,
      deadline: "2026-08-14",
      actualVelocity: 20,
    });
    expect(result.studyDaysLeft).toBe(13);
    expect(result.requiredPace).toBeCloseTo(100 / 13);
    expect(result.onTrack).toBe(true);
    expect(result.daysLate).toBe(0);
  });

  it("reports how late the projection lands", () => {
    const result = assessPace({
      ...base,
      remainingUnits: 100,
      deadline: "2026-07-31",
      actualVelocity: 20,
    });
    expect(result.onTrack).toBe(false);
    expect(result.projectedFinish).toBe("2026-08-04");
    expect(result.daysLate).toBe(4);
  });

  it("caps the sustainable pace at the stated daily capacity", () => {
    // A week of cramming should not certify a plan that needs 8 units a day
    // from someone who has told us they can manage 5.
    const result = assessPace({
      ...base,
      remainingUnits: 100,
      deadline: "2026-08-14",
      actualVelocity: 20,
      dailyCapacityUnits: 5,
    });
    expect(result.onTrack).toBe(false);
  });

  it("treats a finished course as on track whatever the velocity", () => {
    const result = assessPace({
      ...base,
      remainingUnits: 0,
      deadline: "2026-07-30",
      actualVelocity: 0,
    });
    expect(result.requiredPace).toBe(0);
    expect(result.onTrack).toBe(true);
  });

  it("needs an infinite pace once the deadline has passed", () => {
    const result = assessPace({
      ...base,
      remainingUnits: 100,
      deadline: "2026-07-01",
      actualVelocity: 20,
    });
    expect(result.studyDaysLeft).toBe(0);
    expect(result.requiredPace).toBe(Infinity);
    expect(result.onTrack).toBe(false);
  });

  it("cannot project a finish from a standstill", () => {
    const result = assessPace({
      ...base,
      remainingUnits: 100,
      deadline: "2026-08-14",
      actualVelocity: 0,
    });
    expect(result.projectedFinish).toBeNull();
    // Unknowable, not late: an invented number here would be noise.
    expect(result.daysLate).toBe(0);
    expect(result.onTrack).toBe(false);
  });
});

describe("assessCourse", () => {
  const subject = course({
    id: "course_health",
    topics: [
      topic({ id: "topic_1", totalUnits: 100, completedUnits: 40 }),
      topic({ id: "topic_2", totalUnits: 100, completedUnits: 20 }),
    ],
    exams: [exam({ id: "finals", startDate: "2026-08-14" })],
  });

  it("summarises progress, deadline, and pace together", () => {
    const health = assessCourse({
      course: subject,
      today: TODAY,
      calendar: WEEKDAYS_ONLY,
      log: log([
        { date: "2026-07-27", units: 50, topicId: "topic_1" },
        { date: "2026-07-28", units: 50, topicId: "topic_2" },
      ]),
    });

    expect(health.courseId).toBe("course_health");
    expect(health.progress.remainingUnits).toBe(140);
    expect(health.exam?.id).toBe("finals");
    expect(health.daysUntilExam).toBe(16);
    expect(health.pace?.actualVelocity).toBe(20);
  });

  it("counts only its own topics towards velocity", () => {
    const health = assessCourse({
      course: subject,
      today: TODAY,
      calendar: WEEKDAYS_ONLY,
      log: log([{ date: "2026-07-27", units: 500, topicId: "topic_elsewhere" }]),
    });
    expect(health.pace?.actualVelocity).toBe(0);
  });

  it("has no pace to report without an upcoming exam", () => {
    // Without a deadline, "behind" is meaningless; inventing one would put an
    // alarming number on a course that simply is not scheduled yet.
    const health = assessCourse({
      course: course({ topics: subject.topics }),
      today: TODAY,
      calendar: WEEKDAYS_ONLY,
      log: [],
    });
    expect(health.exam).toBeNull();
    expect(health.daysUntilExam).toBeNull();
    expect(health.pace).toBeNull();
  });
});
