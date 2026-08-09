import { describe, expect, it } from "vitest";
import { topic as makeTopic } from "@/test/factories";
import type { StudyBlock } from "@/domain";
import { clampToLimits, fillsByBlock, limitsAround, limitsFor } from "./blocks";

function block(overrides: Partial<StudyBlock> & { id: string }): StudyBlock {
  return {
    topicId: "topic_1",
    startDate: "2026-05-04",
    endDate: "2026-05-08",
    source: "auto",
    ...overrides,
  };
}

describe("progress across a topic's bars", () => {
  it("spreads one quantity over the bars instead of repeating it on each", () => {
    // Half of a topic scheduled in two equal windows is one full bar and one
    // empty one, not two half-full bars — which is what "40% done" drawn four
    // times over used to claim.
    const topic = makeTopic({
      totalUnits: 100,
      completedUnits: 50,
      blocks: [
        block({ id: "a", startDate: "2026-05-04", endDate: "2026-05-08" }),
        block({ id: "b", startDate: "2026-05-11", endDate: "2026-05-15" }),
      ],
    });

    const fills = fillsByBlock(topic);
    expect(fills.get("a")).toBe(1);
    expect(fills.get("b")).toBe(0);
  });

  it("runs out partway through a bar", () => {
    const topic = makeTopic({
      totalUnits: 100,
      completedUnits: 75,
      blocks: [
        block({ id: "a", startDate: "2026-05-04", endDate: "2026-05-05" }),
        block({ id: "b", startDate: "2026-05-06", endDate: "2026-05-07" }),
      ],
    });

    expect(fillsByBlock(topic).get("b")).toBeCloseTo(0.5);
  });

  it("fills the earliest bar first however the blocks are ordered", () => {
    const topic = makeTopic({
      totalUnits: 10,
      completedUnits: 5,
      blocks: [
        block({ id: "later", startDate: "2026-06-01", endDate: "2026-06-02" }),
        block({ id: "earlier", startDate: "2026-05-04", endDate: "2026-05-05" }),
      ],
    });

    const fills = fillsByBlock(topic);
    expect(fills.get("earlier")).toBe(1);
    expect(fills.get("later")).toBe(0);
  });

  it("weights by the scheduler's own intent when every block carries one", () => {
    // Same length, different plans: three quarters done is the whole of the
    // 30-unit window and none of the 10-unit one.
    const topic = makeTopic({
      totalUnits: 40,
      completedUnits: 30,
      blocks: [
        block({ id: "big", plannedUnits: 30 }),
        block({ id: "small", startDate: "2026-05-11", endDate: "2026-05-15", plannedUnits: 10 }),
      ],
    });

    const fills = fillsByBlock(topic);
    expect(fills.get("big")).toBe(1);
    expect(fills.get("small")).toBe(0);
  });

  it("draws nothing for a topic whose size is untracked", () => {
    const topic = makeTopic({ totalUnits: 0, completedUnits: 0, blocks: [block({ id: "a" })] });
    expect(fillsByBlock(topic).get("a")).toBe(0);
  });
});

describe("keeping a topic's bars out of each other", () => {
  const neighbours = [
    block({ id: "before", startDate: "2026-05-01", endDate: "2026-05-03" }),
    block({ id: "after", startDate: "2026-05-20", endDate: "2026-05-22" }),
  ];

  it("frees the days between the nearest neighbours on each side", () => {
    const limits = limitsAround({ startDate: "2026-05-10", endDate: "2026-05-12" }, neighbours);
    expect(limits).toEqual({ earliest: "2026-05-04", latest: "2026-05-19" });
  });

  it("ignores the bar itself", () => {
    const self = block({ id: "self", startDate: "2026-05-10", endDate: "2026-05-12" });
    const topic = makeTopic({ blocks: [...neighbours, self] });
    expect(limitsFor(self, topic)).toEqual({ earliest: "2026-05-04", latest: "2026-05-19" });
  });

  it("stops a move against a neighbour instead of sliding under it", () => {
    const limits = limitsAround({ startDate: "2026-05-10", endDate: "2026-05-12" }, neighbours);
    const moved = clampToLimits({ startDate: "2026-05-25", endDate: "2026-05-27" }, "move", limits);

    // Flush against the later bar, and still three days long: a move that
    // cannot go all the way should arrive, not resize.
    expect(moved).toEqual({ startDate: "2026-05-17", endDate: "2026-05-19" });
  });

  it("stops a resize at the neighbour's edge", () => {
    const limits = limitsAround({ startDate: "2026-05-10", endDate: "2026-05-12" }, neighbours);
    expect(clampToLimits({ startDate: "2026-05-10", endDate: "2026-06-01" }, "end", limits)).toEqual({
      startDate: "2026-05-10",
      endDate: "2026-05-19",
    });
    expect(clampToLimits({ startDate: "2026-04-20", endDate: "2026-05-12" }, "start", limits)).toEqual({
      startDate: "2026-05-04",
      endDate: "2026-05-12",
    });
  });

  it("leaves a bar with no neighbours alone", () => {
    const limits = limitsAround({ startDate: "2026-05-10", endDate: "2026-05-12" }, []);
    expect(limits).toEqual({ earliest: null, latest: null });
    expect(clampToLimits({ startDate: "2027-01-01", endDate: "2027-01-03" }, "move", limits)).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-01-03",
    });
  });
});
