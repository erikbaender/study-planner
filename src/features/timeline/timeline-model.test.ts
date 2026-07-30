import { describe, expect, it } from "vitest";
import { course, exam, plan, topic } from "@/test/factories";
import {
  isTimelineTick,
  moveDateRange,
  snapDragDelta,
  timelineRange,
} from "./timeline-model";

describe("timeline model", () => {
  it("pads a range that includes plan, blocks, exams, and today", () => {
    const semester = plan({
      startDate: "2026-08-01",
      endDate: "2026-12-20",
      courses: [
        course({
          exams: [exam({ startDate: "2027-01-05" })],
          topics: [
            topic({
              blocks: [
                {
                  id: "block_1",
                  topicId: "topic_1",
                  startDate: "2026-07-20",
                  endDate: "2026-07-22",
                  source: "manual",
                },
              ],
            }),
          ],
        }),
      ],
    });

    expect(timelineRange(semester, "2026-07-30")).toEqual({
      start: "2026-07-13",
      end: "2027-01-12",
      dayCount: 184,
    });
  });

  it("applies zoom-specific drag snapping and preserves block duration", () => {
    expect(snapDragDelta(16, "day")).toBe(1);
    expect(snapDragDelta(34, "week")).toBe(0);
    expect(snapDragDelta(36, "week")).toBe(7);
    expect(snapDragDelta(170, "month")).toBe(60);
    expect(moveDateRange("2026-07-30", "2026-08-02", 7)).toEqual({
      startDate: "2026-08-06",
      endDate: "2026-08-09",
    });
  });

  it("chooses progressively coarser tick boundaries", () => {
    expect(isTimelineTick("2026-07-30", "day")).toBe(true);
    expect(isTimelineTick("2026-08-03", "week")).toBe(true);
    expect(isTimelineTick("2026-08-01", "month")).toBe(true);
    expect(isTimelineTick("2026-10-01", "quarter")).toBe(true);
    expect(isTimelineTick("2026-11-01", "quarter")).toBe(false);
  });
});
