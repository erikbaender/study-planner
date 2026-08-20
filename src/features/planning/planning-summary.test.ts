import { describe, expect, it } from "vitest";
import { countDaysTouched } from "./planning-summary";

describe("countDaysTouched", () => {
  it("counts every day in a range, including both endpoints", () => {
    expect(countDaysTouched([{ startDate: "2026-05-04", endDate: "2026-05-06" }])).toBe(3);
  });

  it("counts overlapping ranges only once", () => {
    expect(
      countDaysTouched([
        { startDate: "2026-05-04", endDate: "2026-05-06" },
        { startDate: "2026-05-06", endDate: "2026-05-08" },
      ]),
    ).toBe(5);
  });

  it("returns zero when there are no blocks", () => {
    expect(countDaysTouched([])).toBe(0);
  });
});
