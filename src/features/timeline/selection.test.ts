import { describe, expect, it } from "vitest";
import { course as makeCourse, topic as makeTopic } from "@/test/factories";
import { applyDelta, clampDelta, groupRange, rangeFor, type BarTarget } from "./selection";
import { createSelectionStore } from "./chart-context";

const block = (id: string, startDate: string, endDate: string) => ({
  id,
  topicId: "topic_1",
  startDate,
  endDate,
  source: "auto" as const,
});

describe("rangeFor", () => {
  it("stops a move against the neighbours on either side", () => {
    const subject = block("b", "2026-05-11", "2026-05-15");
    const range = rangeFor("move", subject, [
      block("a", "2026-05-04", "2026-05-08"),
      block("c", "2026-05-20", "2026-05-22"),
    ]);
    // One day clear of each: the 9th at the earliest, the 19th at the latest.
    expect(range).toEqual({ min: -2, max: 4 });
  });

  it("lets an edge shrink to a single day and no further", () => {
    const subject = block("b", "2026-05-11", "2026-05-15");
    expect(rangeFor("end", subject, []).min).toBe(-4);
    expect(rangeFor("start", subject, []).max).toBe(4);
  });

  it("is unbounded where nothing is in the way", () => {
    expect(rangeFor("move", block("b", "2026-05-11", "2026-05-15"), [])).toEqual({
      min: -Infinity,
      max: Infinity,
    });
  });
});

describe("groupRange", () => {
  it("is the intersection: the first bar to run out stops the gesture", () => {
    const blocked = makeTopic({
      id: "topic_1",
      blocks: [block("a", "2026-05-04", "2026-05-08"), block("wall", "2026-05-12", "2026-05-14")],
    });
    const open = makeTopic({ id: "topic_2", blocks: [block("b", "2026-05-04", "2026-05-06")] });
    const course = makeCourse({ topics: [blocked, open] });
    const targets: BarTarget[] = [
      { block: blocked.blocks[0], topic: blocked, course },
      { block: open.blocks[0], topic: open, course },
    ];

    const range = groupRange("move", targets, new Set(["a", "b"]));
    expect(range.max).toBe(3);
    expect(clampDelta(range, 14)).toBe(3);
  });

  it("ignores neighbours that are travelling with the selection", () => {
    const topic = makeTopic({
      id: "topic_1",
      blocks: [block("a", "2026-05-04", "2026-05-08"), block("b", "2026-05-12", "2026-05-14")],
    });
    const course = makeCourse({ topics: [topic] });
    const targets: BarTarget[] = topic.blocks.map((entry) => ({ block: entry, topic, course }));

    // Both selected: the gap between them is not changing, so neither bounds
    // the other and the pair can travel as far as the empty canvas allows.
    expect(groupRange("move", targets, new Set(["a", "b"]))).toEqual({
      min: -Infinity,
      max: Infinity,
    });
  });
});

describe("createSelectionStore", () => {
  it("keeps the last selected id primary and the others secondary", () => {
    const selection = createSelectionStore();

    selection.set(["first", "second"]);

    expect(selection.stateOf("first")).toBe("secondary");
    expect(selection.stateOf("second")).toBe("primary");
    expect(selection.stateOf("other")).toBeNull();
  });
});

describe("applyDelta", () => {
  it("moves both ends, or exactly one of them", () => {
    const span = { startDate: "2026-05-11", endDate: "2026-05-15" };
    expect(applyDelta("move", span, 2)).toEqual({ startDate: "2026-05-13", endDate: "2026-05-17" });
    expect(applyDelta("start", span, 2)).toEqual({ startDate: "2026-05-13", endDate: "2026-05-15" });
    expect(applyDelta("end", span, -2)).toEqual({ startDate: "2026-05-11", endDate: "2026-05-13" });
  });
});
