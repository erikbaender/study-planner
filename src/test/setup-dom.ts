import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * jsdom, patched up to the point where Radix works.
 *
 * Radix's overlays measure and position themselves, and jsdom implements none
 * of the APIs that requires. The shims below are deliberately dumb: their job is
 * to stop a component throwing, not to simulate layout — no assertion in this
 * suite depends on a measured size, because a measurement from jsdom would be a
 * fiction either way.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMRectStub {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  top = 0;
  left = 0;
  right = 0;
  bottom = 0;
  toJSON() {
    return this;
  }
  // Radix's context menu builds a virtual anchor from the pointer position with
  // `DOMRect.fromRect`, which jsdom does not ship.
  static fromRect(rect: { x?: number; y?: number; width?: number; height?: number } = {}) {
    return new DOMRectStub(rect.x, rect.y, rect.width, rect.height);
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("DOMRect", DOMRectStub);

  // Floating-UI asks for these on every positioned element.
  Element.prototype.scrollIntoView ??= () => {};
  // Radix uses pointer capture to keep a drag attached to its trigger.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};

  /**
   * jsdom's `matchMedia` exists but always reports `matches: false`, which would
   * make every appearance test look like a light-mode user. Replaced with a
   * settable stub so tests can say which OS theme they are running under.
   */
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      matches: false,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // Appearance is stored globally, so one test's choice would otherwise be the
  // next test's starting state.
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
});
