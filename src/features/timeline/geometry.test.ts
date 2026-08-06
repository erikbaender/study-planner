import { describe, expect, it } from "vitest";
import { course as makeCourse, exam as makeExam, topic as makeTopic } from "@/test/factories";
import {
  bandsFor,
  dateAt,
  daysMoved,
  PX_PER_DAY,
  ticksFor,
  timelineRange,
  weekendsIn,
  widthOf,
  xOf,
} from "./geometry";

const START = "2026-05-04"; // a Monday

describe("timeline geometry", () => {
  it("round-trips a date through the canvas", () => {
    // An off-by-one here puts every bar one column left of the day it claims,
    // which no screenshot would catch.
    for (const zoom of ["day", "week", "month"] as const) {
      const date = "2026-06-11";
      expect(dateAt(xOf(date, START, zoom), START, zoom)).toBe(date);
    }
  });

  it("measures a one-day block as one day wide, not zero", () => {
    expect(widthOf("2026-05-04", "2026-05-04", "day")).toBe(PX_PER_DAY.day);
    expect(widthOf("2026-05-04", "2026-05-06", "day")).toBe(PX_PER_DAY.day * 3);
  });

  it("snaps a drag to the zoom's unit", () => {
    expect(daysMoved(PX_PER_DAY.day * 2.4, "day")).toBe(2);
    // Quarter zoom snaps to the week: at under two pixels a day, a single day
    // is narrower than the pointer that would have to hit it.
    expect(daysMoved(PX_PER_DAY.quarter * 10, "quarter")).toBe(7);
  });

  it("covers every date in the plan, with room at both ends", () => {
    const plan = [
      makeCourse({
        exams: [makeExam({ startDate: "2026-07-01" })],
        topics: [
          makeTopic({
            blocks: [
              {
                id: "b1",
                topicId: "t1",
                startDate: "2026-05-20",
                endDate: "2026-05-24",
                source: "auto",
              },
            ],
          }),
        ],
      }),
    ];
    const range = timelineRange(plan, "2026-06-01");

    expect(range.start < "2026-05-20").toBe(true);
    expect(range.end > "2026-07-01").toBe(true);
  });

  it("thins the ruler out as the zoom widens", () => {
    const day = ticksFor(START, "2026-08-04", "day");
    const month = ticksFor(START, "2026-08-04", "month");
    expect(day.length).toBeGreaterThan(90);
    // Three or four labels rather than ninety-three: a tick per day at this
    // scale is an unreadable stripe.
    expect(month.length).toBeLessThan(6);
  });

  it("bands the ruler by month up close and by year from far away", () => {
    const months = bandsFor(START, "2026-08-04", "week");
    expect(months.length).toBe(4);
    // Clipped to the canvas: the first band cannot start before the chart does.
    expect(months[0].start).toBe(START);
    expect(months[3].end).toBe("2026-08-04");

    const years = bandsFor(START, "2027-02-01", "quarter");
    expect(years.map((band) => band.label)).toEqual(["2026", "2027"]);
  });

  it("marks month ticks on the first of the month, whatever the local zone", () => {
    // Serialising a locally-parsed date through `toISOString` put every one of
    // these on the last day of the previous month east of UTC.
    for (const tick of ticksFor(START, "2026-12-31", "month")) {
      expect(tick.date.slice(8)).toBe("01");
    }
  });

  it("finds both weekend days of every week", () => {
    const weekend = weekendsIn(START, "2026-05-17"); // two whole weeks from a Monday
    expect(weekend).toEqual(["2026-05-09", "2026-05-10", "2026-05-16", "2026-05-17"]);
  });
});
