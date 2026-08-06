import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  clampDate,
  countStudyDays,
  differenceInDays,
  eachDayInclusive,
  endOfMonth,
  isStudyDay,
  isValidIsoDate,
  maxDate,
  minDate,
  rangeLengthInDays,
  rangesOverlap,
  startOfMonth,
  startOfWeek,
  studyDaysBetween,
  toIsoDate,
  weekdayOf,
  type StudyCalendar,
} from "./dates";

const WEEKDAYS_ONLY: StudyCalendar = {
  studyDaysOfWeek: [1, 2, 3, 4, 5],
  blackoutDates: [],
};

describe("isValidIsoDate", () => {
  it("accepts a real calendar day", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects a day that Date would silently roll forward", () => {
    // The bug this guards: `new Date("2026-02-31")` is 3 March, not an error.
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
  });

  it("rejects anything that is not exactly YYYY-MM-DD", () => {
    expect(isValidIsoDate("2026-2-01")).toBe(false);
    expect(isValidIsoDate("2026-02-01T00:00:00Z")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});

describe("UTC handling", () => {
  /**
   * The regression these two guard: with local-time accessors, every date west
   * of Greenwich reads back as the previous day. Vitest runs with whatever TZ
   * the machine has, so the assertions must hold in any zone.
   */
  it("round-trips a date through parse and format", () => {
    expect(toIsoDate(new Date("2026-07-29T00:00:00.000Z"))).toBe("2026-07-29");
  });

  it("reports the UTC weekday", () => {
    expect(weekdayOf("2026-07-29")).toBe(3);
    expect(weekdayOf("2026-08-02")).toBe(0);
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-07-29", 5)).toBe("2026-08-03");
  });

  it("goes backwards", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("crosses a leap day", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("differenceInDays", () => {
  it("is negative when the target precedes the origin", () => {
    expect(differenceInDays("2026-07-29", "2026-07-24")).toBe(-5);
  });

  it("is zero for the same day", () => {
    expect(differenceInDays("2026-07-29", "2026-07-29")).toBe(0);
  });

  it("survives a daylight-saving transition", () => {
    // Late March in Europe: a naive local-time subtraction gives 30.958… days,
    // which `Math.round` happens to rescue but which drifts once the offset
    // stacks up. Every accessor being UTC is what actually makes this exact.
    expect(differenceInDays("2026-03-01", "2026-04-01")).toBe(31);
  });
});

describe("range helpers", () => {
  it("clamps into bounds", () => {
    expect(clampDate("2026-01-01", "2026-02-01", "2026-03-01")).toBe("2026-02-01");
    expect(clampDate("2026-04-01", "2026-02-01", "2026-03-01")).toBe("2026-03-01");
    expect(clampDate("2026-02-15", "2026-02-01", "2026-03-01")).toBe("2026-02-15");
  });

  it("picks the extremes", () => {
    expect(minDate("2026-03-01", "2026-01-01", "2026-02-01")).toBe("2026-01-01");
    expect(maxDate("2026-03-01", "2026-01-01", "2026-02-01")).toBe("2026-03-01");
  });

  it("enumerates inclusively and returns nothing for an inverted range", () => {
    expect(eachDayInclusive("2026-07-29", "2026-07-31")).toEqual([
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
    expect(eachDayInclusive("2026-07-29", "2026-07-29")).toEqual(["2026-07-29"]);
    expect(eachDayInclusive("2026-07-31", "2026-07-29")).toEqual([]);
  });

  it("counts a single-day range as one day", () => {
    expect(rangeLengthInDays("2026-07-29", "2026-07-29")).toBe(1);
    expect(rangeLengthInDays("2026-07-31", "2026-07-29")).toBe(0);
  });

  it("treats touching ranges as overlapping", () => {
    expect(rangesOverlap("2026-07-01", "2026-07-10", "2026-07-10", "2026-07-20")).toBe(true);
    expect(rangesOverlap("2026-07-01", "2026-07-09", "2026-07-10", "2026-07-20")).toBe(false);
  });
});

describe("study calendar", () => {
  it("excludes non-study weekdays", () => {
    expect(isStudyDay("2026-08-02", WEEKDAYS_ONLY)).toBe(false);
    expect(isStudyDay("2026-07-29", WEEKDAYS_ONLY)).toBe(true);
  });

  it("excludes blackout dates even on a study weekday", () => {
    const calendar: StudyCalendar = { ...WEEKDAYS_ONLY, blackoutDates: ["2026-07-29"] };
    expect(isStudyDay("2026-07-29", calendar)).toBe(false);
  });

  it("lists the available days in a range", () => {
    // Mon 27 Jul through Sun 2 Aug.
    expect(studyDaysBetween("2026-07-27", "2026-08-02", WEEKDAYS_ONLY)).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
  });

  it("counts a full week as five study days", () => {
    expect(countStudyDays("2026-07-27", "2026-08-02", WEEKDAYS_ONLY)).toBe(5);
  });
});

describe("month and week boundaries", () => {
  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-07-29")).toBe("2026-07-27");
    expect(startOfWeek("2026-07-27")).toBe("2026-07-27");
    // Sunday belongs to the week that began six days earlier, not the next one.
    expect(startOfWeek("2026-08-02")).toBe("2026-07-27");
  });

  it("finds month bounds", () => {
    expect(startOfMonth("2026-07-29")).toBe("2026-07-01");
    expect(endOfMonth("2026-07-29")).toBe("2026-07-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
  });

  it("clamps to the last day of the target month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", 13)).toBe("2027-02-15");
  });
});
