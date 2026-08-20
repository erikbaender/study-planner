import { describe, expect, it } from "vitest";
import { topic } from "@/test/factories";
import { PLANNER_LIMITS as CONVEX_PLANNER_LIMITS } from "../../convex/plannerGuards";
import { DEFAULT_PREFERENCES } from "./types";
import {
  buildDependencyGraph,
  createsCycle,
  PLANNER_LIMITS,
  requireAcyclic,
  requireAllowedValue,
  requireBoundedArray,
  requireBoundedText,
  requireCompleteReorder,
  requireDistinctBoundedArray,
  requireFiniteBoundedNumber,
  requireNonEmpty,
  requireNonNegative,
  requireOrderedDates,
  requirePlannedUnits,
  requireTrimmedBoundedText,
  requireValidAutoBlockReplacement,
  requireValidDate,
  requireValidPreferences,
  requireValidProgress,
  topologicalOrder,
  ValidationError,
} from "./validation";

describe("validation limits", () => {
  it("keeps every client limit aligned with the Convex boundary", () => {
    // The deployable server guard intentionally remains independent of client
    // modules. Comparing its pure constants here makes an intentional limit
    // change fail until both sides are updated.
    expect(CONVEX_PLANNER_LIMITS).toMatchObject(PLANNER_LIMITS);
  });
});

describe("field validation", () => {
  it("trims and rejects blank strings", () => {
    expect(requireNonEmpty("  Anatomy  ", "Name")).toBe("Anatomy");
    expect(() => requireNonEmpty("   ", "Name")).toThrow(ValidationError);
  });

  it("requires canonical bounded names and codes", () => {
    expect(() => requireTrimmedBoundedText("Anatomy", "Name", 10)).not.toThrow();
    expect(() => requireTrimmedBoundedText(" Anatomy ", "Name", 20)).toThrow("whitespace");
    expect(() => requireTrimmedBoundedText("Ana\0tomy", "Name", 20)).toThrow(
      "control characters",
    );
    expect(() => requireTrimmedBoundedText("Anatomy", "Name", 3)).toThrow("3 characters");
  });

  it("bounds free-form text without trimming it", () => {
    expect(() => requireBoundedText("  note  ", "Notes", 10)).not.toThrow();
    expect(() => requireBoundedText("too long", "Notes", 3)).toThrow("3 characters");
  });

  it("validates runtime enum values", () => {
    expect(() => requireAllowedValue("manual", ["auto", "manual"], "Source")).not.toThrow();
    expect(() => requireAllowedValue("other", ["auto", "manual"], "Source")).toThrow(
      "Source is invalid",
    );
  });

  it("names the offending field on the error", () => {
    try {
      requireNonEmpty("", "Course name");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe("Course name");
      expect((error as ValidationError).message).toBe("Course name is required");
    }
  });

  it("rejects negative and non-finite numbers", () => {
    expect(requireNonNegative(0, "Units")).toBe(0);
    expect(() => requireNonNegative(-1, "Units")).toThrow(ValidationError);
    expect(() => requireNonNegative(Number.NaN, "Units")).toThrow(ValidationError);
    expect(() => requireNonNegative(Infinity, "Units")).toThrow(ValidationError);
  });

  it("enforces finite numeric ranges and integers", () => {
    expect(requireFiniteBoundedNumber(5, "Count", { minimum: 0, maximum: 5 })).toBe(5);
    expect(() => requireFiniteBoundedNumber(Infinity, "Count")).toThrow("finite number");
    expect(() => requireFiniteBoundedNumber(-1, "Count", { minimum: 0 })).toThrow("at least 0");
    expect(() => requireFiniteBoundedNumber(6, "Count", { maximum: 5 })).toThrow("exceed 5");
    expect(() => requireFiniteBoundedNumber(1.5, "Count", { integer: true })).toThrow("integer");
  });

  it("allows a same-day range but not a reversed one", () => {
    expect(() => requireOrderedDates("2026-07-29", "2026-07-29")).not.toThrow();
    expect(() => requireOrderedDates("2026-07-29", "2026-07-28")).toThrow(
      "End date cannot be before start date",
    );
  });

  it("rejects a malformed date before comparing", () => {
    expect(() => requireOrderedDates("2026-02-31", "2026-03-05")).toThrow(
      "Start date must be a valid date",
    );
  });

  it("validates a start or log date even when there is no range end", () => {
    expect(() => requireOrderedDates("2026-02-31")).toThrow(
      "Start date must be a valid date",
    );
    expect(() => requireValidDate("2026-02-31", "Study date")).toThrow(
      "Study date must be a valid date",
    );
  });
});

describe("requireValidProgress", () => {
  it("rejects completing more than exists", () => {
    expect(() => requireValidProgress(120, 100)).toThrow("Completed units cannot exceed the total");
  });

  it("allows any completed count when the size is untracked", () => {
    // `totalUnits === 0` means "we do not know how big this is", so there is
    // nothing to exceed.
    expect(() => requireValidProgress(40, 0)).not.toThrow();
  });

  it("allows exactly finishing", () => {
    expect(() => requireValidProgress(100, 100)).not.toThrow();
  });

  it("enforces the shared unit bound", () => {
    expect(() => requireValidProgress(0, PLANNER_LIMITS.units + 1)).toThrow(
      `Total units cannot exceed ${PLANNER_LIMITS.units}`,
    );
    expect(() => requirePlannedUnits(PLANNER_LIMITS.units + 1)).toThrow(
      `Planned units cannot exceed ${PLANNER_LIMITS.units}`,
    );
  });
});

describe("collection validation", () => {
  it("bounds arrays and rejects duplicate values", () => {
    expect(() => requireBoundedArray(["a", "b"], "Values", 1)).toThrow("more than 1");
    expect(() => requireDistinctBoundedArray(["a", "a"], "Values", 2)).toThrow(
      "duplicates",
    );
  });

  it("requires a complete reorder of existing siblings", () => {
    expect(() => requireCompleteReorder(["a", "b"], ["b", "a"], "Ids")).not.toThrow();
    expect(() => requireCompleteReorder(["a", "b"], ["a"], "Ids")).toThrow(
      "every sibling exactly once",
    );
    expect(() => requireCompleteReorder(["a", "b"], ["a", "elsewhere"], "Ids")).toThrow(
      "every sibling exactly once",
    );
  });

  it("validates bounded, distinct generated schedule inputs", () => {
    const block = { topicId: "topic_a", startDate: "2026-08-01", endDate: "2026-08-02" };
    expect(() => requireValidAutoBlockReplacement(["topic_a"], [block])).not.toThrow();
    expect(() => requireValidAutoBlockReplacement(["topic_a", "topic_a"], [])).toThrow(
      "duplicates",
    );
    expect(() => requireValidAutoBlockReplacement(["topic_b"], [block])).toThrow(
      "outside the reflow scope",
    );
    expect(() => requireValidAutoBlockReplacement(["topic_a"], [block, block])).toThrow(
      "Generated blocks cannot contain duplicates",
    );
  });
});

describe("preferences validation", () => {
  it("accepts canonical preferences", () => {
    expect(() => requireValidPreferences(DEFAULT_PREFERENCES)).not.toThrow();
  });

  it("rejects invalid capacity, days, dates, theme, and accent values", () => {
    expect(() =>
      requireValidPreferences({ ...DEFAULT_PREFERENCES, dailyCapacityUnits: Infinity }),
    ).toThrow("finite number");
    expect(() =>
      requireValidPreferences({ ...DEFAULT_PREFERENCES, studyDaysOfWeek: [1, 1] }),
    ).toThrow("duplicates");
    expect(() =>
      requireValidPreferences({
        ...DEFAULT_PREFERENCES,
        blackoutDates: ["2026-02-31"],
      }),
    ).toThrow("Blackout date must be a valid date");
    expect(() =>
      requireValidPreferences({ ...DEFAULT_PREFERENCES, theme: "sepia" }),
    ).toThrow("Theme is invalid");
    expect(() =>
      requireValidPreferences({ ...DEFAULT_PREFERENCES, accentColor: " accent " }),
    ).toThrow("whitespace");
  });
});

describe("createsCycle", () => {
  const graph = (edges: Record<string, string[]>) =>
    buildDependencyGraph(
      Object.entries(edges).map(([id, dependencyIds]) => topic({ id, dependencyIds })),
    );

  it("catches a topic depending on itself", () => {
    expect(createsCycle(graph({ a: [] }), "a", ["a"])).toBe(true);
  });

  it("catches a direct back edge", () => {
    expect(createsCycle(graph({ a: [], b: ["a"] }), "a", ["b"])).toBe(true);
  });

  it("catches a cycle several hops away", () => {
    expect(createsCycle(graph({ a: [], b: ["a"], c: ["b"], d: ["c"] }), "a", ["d"])).toBe(true);
  });

  it("allows a diamond", () => {
    // b and c both depend on a, and d on both — a shared ancestor is not a loop,
    // and a naive "have I seen this node" check would call it one.
    expect(createsCycle(graph({ a: [], b: ["a"], c: ["a"], d: [] }), "d", ["b", "c"])).toBe(false);
  });

  it("ignores dependencies pointing at unknown ids", () => {
    expect(createsCycle(graph({ a: [] }), "a", ["ghost"])).toBe(false);
  });

  it("terminates on a graph that is already cyclic", () => {
    expect(createsCycle(graph({ a: ["b"], b: ["a"] }), "c", ["a"])).toBe(false);
  });

  it("is what requireAcyclic reports on", () => {
    expect(() => requireAcyclic(graph({ a: [], b: ["a"] }), "a", ["b"])).toThrow(
      "That would create a circular dependency",
    );
  });
});

describe("topologicalOrder", () => {
  const names = (topics: ReturnType<typeof topologicalOrder>) => topics.map((item) => item.id);

  it("puts dependencies first", () => {
    const sorted = topologicalOrder([
      topic({ id: "c", order: 0, dependencyIds: ["b"] }),
      topic({ id: "b", order: 1, dependencyIds: ["a"] }),
      topic({ id: "a", order: 2 }),
    ]);
    expect(names(sorted)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties by order, so the result is stable", () => {
    const sorted = topologicalOrder([
      topic({ id: "second", order: 1 }),
      topic({ id: "first", order: 0 }),
      topic({ id: "third", order: 2 }),
    ]);
    expect(names(sorted)).toEqual(["first", "second", "third"]);
  });

  it("keeps every topic even when the graph has a cycle", () => {
    // Validation should stop this reaching the scheduler, but a scheduler that
    // silently drops topics on bad data is worse than one that orders them oddly.
    const sorted = topologicalOrder([
      topic({ id: "a", order: 0, dependencyIds: ["b"] }),
      topic({ id: "b", order: 1, dependencyIds: ["a"] }),
      topic({ id: "c", order: 2 }),
    ]);
    expect(names(sorted).sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores dependencies on topics outside the set", () => {
    const sorted = topologicalOrder([topic({ id: "a", dependencyIds: ["elsewhere"] })]);
    expect(names(sorted)).toEqual(["a"]);
  });
});
