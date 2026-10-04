import { describe, expect, it } from "vitest";
import { course, exam, topic } from "@/test/factories";
import { schedule, courseProgress, describeShortfall, DEFAULT_PREFERENCES, minutesPerUnit } from "@/domain";

const today = "2026-10-05";
const calendar = { ...DEFAULT_PREFERENCES, studyDaysOfWeek: [0,1,2,3,4,5,6] as (0|1|2|3|4|5|6)[] };
describe("common study time", () => {
  it("keeps mixed material counts while every generated day respects the minute budget", () => {
    const topics = [topic({ id: "practice", unit: "hours", totalUnits: 4 }), topic({ id: "slides", totalUnits: 30, minutesPerUnit: 2 }), topic({ id: "cards", unit: "cards", totalUnits: 100, minutesPerUnit: 0.5 })];
    const result = schedule({ courses: [course({ topics, exams: [exam({ startDate: "2026-10-09" })] })], today, calendar, dailyCapacityMinutes: 120 });
    const loads = new Map<string, number>();
    for (const block of result.blocks) {
      expect(block.startDate).toBe(block.endDate);
      const rate = minutesPerUnit(topics.find(topic => topic.id === block.topicId)!);
      loads.set(block.startDate, (loads.get(block.startDate) ?? 0) + block.plannedUnits * rate);
    }
    expect([...loads.values()].every(load => load <= 120)).toBe(true);
    expect([...loads.values()].reduce((a,b) => a+b, 0)).toBe(350);
    for (const item of topics) expect(result.blocks.filter(block => block.topicId === item.id).reduce((sum, block) => sum + block.plannedUnits, 0)).toBeCloseTo(item.totalUnits);
    expect(result.shortfalls).toEqual([]);
  });
  it("reserves manual hours, reports minute shortfalls, and honors a zero-minute budget", () => {
    const material = topic({ id: "reading", unit: "pages", totalUnits: 20, minutesPerUnit: 5 });
    const practice = topic({ id: "practice", unit: "hours", totalUnits: 2, blocks: [{ id: "manual", topicId: "practice", startDate: today, endDate: today, plannedUnits: 2, source: "manual" }] });
    const courses = [course({ topics: [practice, material], exams: [exam({ startDate: today })] })];
    const result = schedule({ courses, today, calendar, dailyCapacityMinutes: 120 });
    expect(result.blocks).toEqual([]);
    expect(result.shortfalls[0]).toMatchObject({ unscheduledUnits: 100, workloadUnit: "minutes" });
    expect(describeShortfall(result.shortfalls[0], 120)).toContain("100 minutes");
    expect(schedule({ courses, today, calendar, dailyCapacityMinutes: 0 }).blocks).toEqual([]);
  });
  it("weights course progress by time and refuses mixed raw-unit schedules", () => {
    const mixed = course({ topics: [topic({ unit: "hours", totalUnits: 2, completedUnits: 1 }), topic({ unit: "cards", totalUnits: 60, completedUnits: 0 })] });
    expect(courseProgress(mixed).ratio).toBeCloseTo(1/3);
    const result = schedule({ courses: [mixed], today, calendar, dailyCapacityUnits: 60 });
    expect(result.blocks).toEqual([]);
    expect(result.warnings.some(warning => warning.type === "legacy-capacity")).toBe(true);
  });
});
