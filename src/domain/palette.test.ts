import { describe, expect, it } from "vitest";
import { coursePalette, DEFAULT_COLOR, leastUsedColor } from "./palette";

describe("coursePalette", () => {
  it("offers exactly twelve distinct colours between the semantic anchors", () => {
    expect(coursePalette).toHaveLength(12);
    expect(new Set(coursePalette.map((color) => color.value)).size).toBe(12);
    expect(coursePalette.map((color) => color.name)).not.toEqual(
      expect.arrayContaining(["Red", "Yellow", "Green", "Blue"]),
    );
  });

  it("uses a palette colour as the default", () => {
    expect(coursePalette.some((color) => color.value === DEFAULT_COLOR)).toBe(true);
  });

  it("suggests every colour once before repeating one", () => {
    const used = coursePalette.slice(0, -1).map((color) => color.value);
    expect(leastUsedColor(used)).toBe(coursePalette.at(-1)?.value);
  });
});
