import { describe, expect, it } from "vitest";
import {
  findAction,
  formatChord,
  isApplePlatform,
  isTypingTarget,
  matchesChord,
  SHORTCUTS,
  type KeyEventLike,
} from "./keyboard";

function press(overrides: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides };
}

describe("isApplePlatform", () => {
  it("recognises Apple hardware and nothing else", () => {
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
    expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });
});

describe("matchesChord", () => {
  const chord = { key: "k", mod: true };

  it("takes ⌘ on Apple and Ctrl elsewhere", () => {
    expect(matchesChord(press({ key: "k", metaKey: true }), chord, true)).toBe(true);
    expect(matchesChord(press({ key: "k", ctrlKey: true }), chord, false)).toBe(true);
  });

  it("does not accept the other platform's modifier", () => {
    // On a Mac, Ctrl+K is "delete to end of line". Opening the palette on it
    // would break a system-wide text-editing key.
    expect(matchesChord(press({ key: "k", ctrlKey: true }), chord, true)).toBe(false);
    expect(matchesChord(press({ key: "k", metaKey: true }), chord, false)).toBe(false);
  });

  it("requires the modifiers to match exactly", () => {
    expect(matchesChord(press({ key: "k" }), chord, true)).toBe(false);
    expect(matchesChord(press({ key: "k", metaKey: true, altKey: true }), chord, true)).toBe(false);
    expect(matchesChord(press({ key: "k", metaKey: true, shiftKey: true }), chord, true)).toBe(
      false,
    );
  });

  it("falls back to the physical key when Option has rewritten the character", () => {
    // macOS turns ⌥N into "˜". Matching on `key` alone would make every
    // Option-based shortcut unreachable on the platform they were designed for.
    const event = press({ key: "˜", code: "KeyN", metaKey: true, altKey: true });
    expect(matchesChord(event, { key: "n", mod: true, alt: true }, true)).toBe(true);
  });

  it("matches digits by their code as well", () => {
    expect(matchesChord(press({ key: "1", code: "Digit1", metaKey: true }), { key: "1", mod: true }, true)).toBe(
      true,
    );
  });

  it("is case-insensitive, so Shift-less capitals still match", () => {
    expect(matchesChord(press({ key: "K", metaKey: true }), chord, true)).toBe(true);
  });
});

describe("findAction", () => {
  it("resolves the chord to its action", () => {
    expect(findAction(press({ key: "k", metaKey: true }), true, false)).toBe("openPalette");
    expect(findAction(press({ key: "2", metaKey: true }), true, false)).toBe("viewTimeline");
    expect(findAction(press({ key: "Backspace", metaKey: true }), true, false)).toBe(
      "deleteSelection",
    );
  });

  it("accepts either chord where an action has two", () => {
    // ⌘I is the one that survives Chrome; ⌥⌘I is the plan's, kept for the
    // browsers that deliver it.
    expect(findAction(press({ key: "i", metaKey: true }), true, false)).toBe("toggleInspector");
    expect(findAction(press({ key: "i", metaKey: true, altKey: true }), true, false)).toBe(
      "toggleInspector",
    );
  });

  it("ignores unbound chords", () => {
    expect(findAction(press({ key: "r", metaKey: true }), true, false)).toBeNull();
  });

  describe("while typing", () => {
    it("suppresses Space, so it types a space instead of quick-looking", () => {
      expect(findAction(press({ key: " " }), true, false)).toBe("quickLook");
      expect(findAction(press({ key: " " }), true, true)).toBeNull();
    });

    it("suppresses ⌘⌫, so it deletes a word instead of a course", () => {
      expect(findAction(press({ key: "Backspace", metaKey: true }), true, true)).toBeNull();
    });

    it("still lets the palette and search through", () => {
      // Both are ways *out* of the field rather than commands that would
      // surprise someone mid-sentence.
      expect(findAction(press({ key: "k", metaKey: true }), true, true)).toBe("openPalette");
      expect(findAction(press({ key: "f", metaKey: true }), true, true)).toBe("focusSearch");
    });
  });
});

describe("isTypingTarget", () => {
  it("is true for the editable things and false for the rest", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.createElement("li"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("is true inside a contenteditable region", () => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    // jsdom does not implement `isContentEditable` from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isTypingTarget(editable)).toBe(true);
  });
});

describe("formatChord", () => {
  it("uses the macOS glyphs, run together", () => {
    expect(formatChord({ key: "k", mod: true }, true)).toBe("⌘K");
    expect(formatChord({ key: "n", mod: true, alt: true }, true)).toBe("⌥⌘N");
    expect(formatChord({ key: "Backspace", mod: true }, true)).toBe("⌘⌫");
    expect(formatChord({ key: " " }, true)).toBe("Space");
  });

  it("spells the modifiers out with plus signs elsewhere", () => {
    expect(formatChord({ key: "k", mod: true }, false)).toBe("Ctrl+K");
    expect(formatChord({ key: "n", mod: true, alt: true }, false)).toBe("Alt+Ctrl+N");
    expect(formatChord({ key: "Backspace", mod: true }, false)).toBe("Ctrl+Backspace");
  });
});

describe("the map itself", () => {
  it("gives every action at least one chord", () => {
    for (const [id, shortcut] of Object.entries(SHORTCUTS)) {
      expect(shortcut.chords.length, `${id} has no chord`).toBeGreaterThan(0);
    }
  });

  it("does not bind two actions to the same chord", () => {
    // A duplicate would resolve by declaration order, silently, and the loser
    // would be a shortcut printed in a menu that never fires.
    const seen = new Set<string>();
    for (const shortcut of Object.values(SHORTCUTS)) {
      for (const chord of shortcut.chords) {
        const key = `${chord.mod ? "m" : ""}${chord.alt ? "a" : ""}${chord.shift ? "s" : ""}:${chord.key.toLowerCase()}`;
        expect(seen.has(key), `${key} is bound twice`).toBe(false);
        seen.add(key);
      }
    }
  });
});
