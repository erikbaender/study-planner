import { describe, expect, it } from "vitest";
import { topic } from "@/test/factories";
import {
  buildDependencyGraph,
  createsCycle,
  requireAcyclic,
  requireNonEmpty,
  requireNonNegative,
  requireOrderedDates,
  requireValidProgress,
  topologicalOrder,
  ValidationError,
} from "./validation";

describe("field validation", () => {
  it("trims and rejects blank strings", () => {
    expect(requireNonEmpty("  Anatomy  ", "Name")).toBe("Anatomy");
    expect(() => requireNonEmpty("   ", "Name")).toThrow(ValidationError);
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
