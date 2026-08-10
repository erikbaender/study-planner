"use client";

/**
 * The modifier vocabulary used by input hints.
 *
 * macOS is the default because it is the visual language of the rest of the
 * application.  The preference is local to this browser, like appearance and
 * motion, and is intentionally independent of the physical operating system:
 * a Windows user can still choose the macOS notation (and vice versa).
 */

import { useSyncExternalStore } from "react";
import { SegmentedControl } from "./segmented-control";

export type KeyboardMode = "mac" | "windows";

const KEYBOARD_MODE_STORAGE_KEY = "planner.keyboardMode";

const DEFAULT_MODE: KeyboardMode = "mac";
const listeners = new Set<() => void>();
let snapshot: KeyboardMode = DEFAULT_MODE;

function isKeyboardMode(value: string | null): value is KeyboardMode {
  return value === "mac" || value === "windows";
}


function readMode(): KeyboardMode {
  try {
    const value = window.localStorage.getItem(KEYBOARD_MODE_STORAGE_KEY);
    return isKeyboardMode(value) ? value : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function getSnapshot(): KeyboardMode {
  const next = readMode();
  if (next !== snapshot) snapshot = next;
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function setMode(next: KeyboardMode) {
  try {
    window.localStorage.setItem(KEYBOARD_MODE_STORAGE_KEY, next);
  } catch {
    // A blocked localStorage should not make the settings popover unusable.
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

export function useKeyboardMode(): KeyboardMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MODE);
}

const MODES = [
  { value: "mac", label: "macOS", ariaLabel: "macOS key labels" },
  { value: "windows", label: "Windows", ariaLabel: "Windows key labels" },
] as const;

export function KeyboardModeControl({ size = "sm" }: { size?: "sm" | "md" }) {
  const mode = useKeyboardMode();
  return (
    <SegmentedControl<KeyboardMode>
      label="Keyboard"
      size={size}
      value={mode}
      onValueChange={setMode}
      segments={MODES}
    />
  );
}
