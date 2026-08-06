import { describe, expect, it } from "vitest";
import { coursePalette, DEFAULT_COLOR_ID, leastUsedColor, resolveCourseColorId } from "./palette";

describe("coursePalette", () => {
  it("offers ten distinct colours between the semantic anchors", () => {
    expect(coursePalette).toHaveLength(10);
    expect(new Set(coursePalette.map((color) => color.id)).size).toBe(10);
    expect(coursePalette.map((color) => color.name)).not.toEqual(
      expect.arrayContaining(["Red", "Yellow", "Green", "Blue"]),
    );
  });

  it("uses a palette colour as the default", () => {
    expect(coursePalette.some((color) => color.id === DEFAULT_COLOR_ID)).toBe(true);
  });

  it("suggests every colour once before repeating one", () => {
    const used = coursePalette.slice(0, -1).map((color) => color.id);
    expect(leastUsedColor(used)).toBe(coursePalette.at(-1)?.id);
  });

  it("maps legacy values, including removed green and blue, onto current references", () => {
    expect(resolveCourseColorId("#ff3b30")).toBe("coral");
    expect(resolveCourseColorId("#53ae55")).toBe("chartreuse");
    expect(resolveCourseColorId("#3d8fd1")).toBe("violet");
  });
});
