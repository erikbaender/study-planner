import { describe, expect, it, vi } from "vitest";
import { animateScrollLeft } from "./motion";

describe("scroll motion", () => {
  it("calls done when the target is already visible at the current offset", () => {
    const element = document.createElement("div");
    element.scrollLeft = 120;
    const done = vi.fn();

    animateScrollLeft(element, 120, done);

    expect(done).toHaveBeenCalledOnce();
  });
});
