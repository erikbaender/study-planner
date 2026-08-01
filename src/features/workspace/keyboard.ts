"use client";

/**
 * The keyboard map, declared once.
 *
 * It lives in its own module because three things need it and they must not
 * disagree: the handler that fires the action, the menus that print the
 * shortcut beside it, and the command palette that lists both. A shortcut
 * printed in a menu that does not fire is worse than no shortcut at all.
 *
 * **On the browser eating shortcuts.** The plan (§7.4) specifies the map a
 * native macOS app would have. A web page does not get all of it: ⌘N, ⌘T and
 * ⌘W are handled by the browser before the page ever sees them, and Chrome
 * takes ⌥⌘I for its developer tools. Where that happens the binding here is the
 * nearest key the page can actually receive, and the plan's original is kept as
 * a second chord for the browsers that do pass it through. This is why every
 * action is also reachable from ⌘K — the palette is the one path that cannot be
 * intercepted, so no action is ever *only* behind a key the browser owns.
 */

import { useEffect, useRef } from "react";

export type Chord = {
  /** `KeyboardEvent.key`, lowercase for letters. Matched against `code` too — see `matchesChord`. */
  key: string;
  /** ⌘ on Apple platforms, Ctrl everywhere else. */
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
};

export type KeyEventLike = {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type ActionId =
  | "openPalette"
  | "focusSearch"
  | "viewToday"
  | "viewTimeline"
  | "viewOutline"
  | "toggleInspector"
  | "newItem"
  | "deleteSelection"
  | "quickLook";

export type Shortcut = {
  /** In display order; the first is the one printed in menus. */
  chords: Chord[];
  label: string;
  /** Fires even while a text field has focus. Only for the ways *out* of one. */
  whileTyping?: boolean;
};

export const SHORTCUTS: Record<ActionId, Shortcut> = {
  openPalette: { chords: [{ key: "k", mod: true }], label: "Command palette", whileTyping: true },
  focusSearch: { chords: [{ key: "f", mod: true }], label: "Search", whileTyping: true },
  viewToday: { chords: [{ key: "1", mod: true }], label: "Today" },
  viewTimeline: { chords: [{ key: "2", mod: true }], label: "Timeline" },
  viewOutline: { chords: [{ key: "3", mod: true }], label: "Outline" },
  toggleInspector: {
    // ⌘I first: the plan asked for ⌥⌘I, which Chrome spends on its developer
    // tools and never delivers. Both are bound so the intended chord works
    // wherever it survives.
    chords: [
      { key: "i", mod: true },
      { key: "i", mod: true, alt: true },
    ],
    label: "Inspector",
  },
  newItem: {
    // ⌘N belongs to the browser — it opens a window and the page is not
    // consulted. ⌥⌘N is the nearest chord that reaches us.
    chords: [{ key: "n", mod: true, alt: true }],
    label: "New",
  },
  deleteSelection: { chords: [{ key: "Backspace", mod: true }], label: "Delete" },
  quickLook: { chords: [{ key: " " }], label: "Quick look" },
};

/**
 * Apple platforms use ⌘ where the rest use Ctrl. Detected from the user agent
 * rather than from a media query because there is no query for it; the argument
 * is injectable so this stays a pure function under test.
 */
export function isApplePlatform(userAgent = globalThis.navigator?.userAgent ?? ""): boolean {
  return /Mac|iPhone|iPad|iPod/.test(userAgent);
}

export function matchesChord(event: KeyEventLike, chord: Chord, apple: boolean): boolean {
  const modPressed = apple ? event.metaKey : event.ctrlKey;
  // The *other* modifier must be up. On a Mac, Ctrl+K is "delete to end of
  // line" and must not open the palette.
  const otherPressed = apple ? event.ctrlKey : event.metaKey;

  if (modPressed !== Boolean(chord.mod)) return false;
  if (otherPressed) return false;
  if (event.altKey !== Boolean(chord.alt)) return false;
  if (event.shiftKey !== Boolean(chord.shift)) return false;

  // `key` and `code` are both consulted. `key` alone breaks on macOS, where
  // holding Option rewrites the character (⌥N arrives as "˜"); `code` alone
  // breaks on non-QWERTY layouts, where the letter is not under the key that
  // reports `KeyN`. Accepting either covers both without punishing anyone.
  const key = event.key.toLowerCase();
  const wanted = chord.key.toLowerCase();
  if (key === wanted) return true;
  if (!event.code) return false;

  const code = event.code;
  if (/^[a-z]$/.test(wanted)) return code === `Key${wanted.toUpperCase()}`;
  if (/^[0-9]$/.test(wanted)) return code === `Digit${wanted}`;
  return code.toLowerCase() === wanted;
}

export function findAction(
  event: KeyEventLike,
  apple: boolean,
  typing: boolean,
): ActionId | null {
  for (const [id, shortcut] of Object.entries(SHORTCUTS) as Array<[ActionId, Shortcut]>) {
    if (typing && !shortcut.whileTyping) continue;
    if (shortcut.chords.some((chord) => matchesChord(event, chord, apple))) return id;
  }
  return null;
}

/**
 * Whether keystrokes belong to whatever the user is editing.
 *
 * Without this, Space quick-looks a topic instead of typing a space in its
 * name, and ⌘⌫ deletes the selected course instead of a word. The exceptions
 * are marked `whileTyping` on the shortcut, and they are all ways *out* of the
 * field rather than commands that would surprise someone mid-sentence.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function formatChord(chord: Chord, apple: boolean): string {
  const parts: string[] = [];
  if (chord.alt) parts.push(apple ? "⌥" : "Alt");
  if (chord.shift) parts.push(apple ? "⇧" : "Shift");
  if (chord.mod) parts.push(apple ? "⌘" : "Ctrl");

  const key =
    chord.key === " "
      ? "Space"
      : chord.key === "Backspace"
        ? apple
          ? "⌫"
          : "Backspace"
        : chord.key.toUpperCase();

  parts.push(key);
  // ⌘K on Apple, Ctrl+K elsewhere: macOS runs the glyphs together, Windows and
  // Linux separate them with plus signs.
  return apple ? parts.join("") : parts.join("+");
}

export function shortcutLabel(id: ActionId, apple: boolean): string {
  return formatChord(SHORTCUTS[id].chords[0], apple);
}

/**
 * Binds the map to the document for as long as the component is mounted.
 *
 * `keydown` on the document rather than on a focused wrapper, because the
 * palette must open no matter where focus is — including inside a portalled
 * popover, which is not a DOM descendant of the shell.
 *
 * The handlers go through a ref so that the listener is attached once. Passed
 * as an effect dependency they would tear down and re-attach on every render,
 * since the caller builds the object inline — which is the natural way to write
 * the call site and should not be a performance trap.
 */
export function useKeyboardMap(handlers: Partial<Record<ActionId, () => void>>) {
  const latest = useRef(handlers);
  // Kept current in an effect with no dependency list, so it re-runs after every
  // render. Assigning during render would be a write to a ref React has not
  // committed yet, which is unsafe under concurrent rendering.
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const apple = isApplePlatform();

    const onKeyDown = (event: KeyboardEvent) => {
      const action = findAction(event, apple, isTypingTarget(event.target));
      if (!action) return;
      const handler = latest.current[action];
      if (!handler) return;
      // Only prevented once an action has claimed the event, so unbound
      // chords — ⌘R, ⌘L, find-in-page — still reach the browser.
      event.preventDefault();
      handler();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
