"use client";

/**
 * Appearance and accent colour.
 *
 * The audit's defect #4 was `const [theme] = useState(...)` — a theme system
 * with the setter dropped, so 876 lines of light-mode CSS could never render.
 * The fix is not "remember to keep the setter": it is to put appearance in one
 * place that owns the DOM attribute, the storage, and the OS listener together.
 *
 * Three appearance values, matching macOS: `light`, `dark`, and `system`, which
 * follows `prefers-color-scheme` *live* — changing the OS theme while the app is
 * open updates it without a reload.
 *
 * Storage is `localStorage`, not the repository, for one reason: the correct
 * theme has to be on `<html>` before first paint, and the repository resolves a
 * frame later. `preferences.theme` in the data model is the durable copy; the
 * two are reconciled in phase 7 when the settings UI lands, with this as the
 * fast cache.
 *
 * Both `localStorage` and `prefers-color-scheme` are external stores, so they
 * are read with `useSyncExternalStore` rather than copied into state inside an
 * effect. That is what makes the server render and the first client render
 * agree — React uses the server snapshot for hydration and swaps in the real
 * value immediately after — and it means a change in another tab updates this
 * one for free.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { applePalette, DEFAULT_COLOR, getPaletteColor } from "@/domain/palette";

export type Appearance = "system" | "light" | "dark";

/** The two values `data-theme` can actually take. */
export type ResolvedAppearance = "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "planner.appearance";
export const ACCENT_STORAGE_KEY = "planner.accent";
export const ANIMATION_SPEED_STORAGE_KEY = "planner.animationSpeed";
export const BASE_TOPIC_MOTION_MS = 240;

const DARK_QUERY = "(prefers-color-scheme: dark)";

type Settings = { appearance: Appearance; accent: string; animationSpeed: number };

const DEFAULTS: Settings = { appearance: "system", accent: DEFAULT_COLOR, animationSpeed: 0.5 };

/* ─── The store ─────────────────────────────────────────────────────────── */

const listeners = new Set<() => void>();

/**
 * Cached because `useSyncExternalStore` compares snapshots by identity: a fresh
 * object on every call would re-render forever.
 */
let snapshot: Settings = DEFAULTS;

function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

function isPaletteColor(value: string): boolean {
  return applePalette.some((color) => color.value === value);
}

function parseAnimationSpeed(value: string | null): number {
  const speed = Number(value);
  return Number.isFinite(speed) && speed >= 0.25 && speed <= 0.75
    ? speed
    : DEFAULTS.animationSpeed;
}

function readStorage(): Settings {
  try {
    const appearance = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    const accent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    const animationSpeed = window.localStorage.getItem(ANIMATION_SPEED_STORAGE_KEY);
    return {
      appearance: isAppearance(appearance) ? appearance : DEFAULTS.appearance,
      // An unknown colour falls back rather than being applied: the accent also
      // has to supply a legible foreground, and only palette colours state one.
      accent: accent && isPaletteColor(accent) ? accent : DEFAULTS.accent,
      animationSpeed: parseAnimationSpeed(animationSpeed),
    };
  } catch {
    // Safari in private mode throws on `localStorage` rather than returning
    // null. An unreadable preference is not worth a blank page.
    return DEFAULTS;
  }
}

function getSnapshot(): Settings {
  const next = readStorage();
  if (
    next.appearance !== snapshot.appearance ||
    next.accent !== snapshot.accent ||
    next.animationSpeed !== snapshot.animationSpeed
  ) {
    snapshot = next;
  }
  return snapshot;
}

function getServerSnapshot(): Settings {
  return DEFAULTS;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` fires in *other* tabs, which is what keeps two open windows in
  // sync; same-tab writes notify through `listeners`.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeSetting(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignored for the same reason as the read: the app stays usable, the
    // preference just does not survive a reload.
  }
  for (const listener of listeners) listener();
}

/* ─── System appearance ─────────────────────────────────────────────────── */

function subscribeToSystem(onChange: () => void): () => void {
  if (!window.matchMedia) return () => {};
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSystemSnapshot(): ResolvedAppearance {
  if (!window.matchMedia) return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/* ─── Provider ──────────────────────────────────────────────────────────── */

type ThemeContextValue = {
  appearance: Appearance;
  /** What `appearance` currently resolves to; equals it unless it is `system`. */
  resolved: ResolvedAppearance;
  setAppearance: (next: Appearance) => void;
  accent: string;
  setAccent: (next: string) => void;
  animationSpeed: number;
  setAnimationSpeed: (next: number) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { appearance, accent, animationSpeed } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const system = useSyncExternalStore(subscribeToSystem, getSystemSnapshot, () => "light" as const);

  const resolved: ResolvedAppearance = appearance === "system" ? system : appearance;

  // Writing to the document is exactly what an effect is for: React state out,
  // external system in.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.setProperty("--mac-accent", accent);
    root.style.setProperty("--mac-on-accent", getPaletteColor(accent).onColor);
    root.style.setProperty(
      "--topic-motion-duration",
      `${BASE_TOPIC_MOTION_MS / animationSpeed}ms`,
    );
  }, [resolved, accent, animationSpeed]);

  const setAppearance = useCallback(
    (next: Appearance) => writeSetting(APPEARANCE_STORAGE_KEY, next),
    [],
  );
  const setAccent = useCallback((next: string) => writeSetting(ACCENT_STORAGE_KEY, next), []);
  const setAnimationSpeed = useCallback(
    (next: number) => writeSetting(ANIMATION_SPEED_STORAGE_KEY, String(next)),
    [],
  );

  const value = useMemo(
    () => ({
      appearance,
      resolved,
      setAppearance,
      accent,
      setAccent,
      animationSpeed,
      setAnimationSpeed,
    }),
    [
      appearance,
      resolved,
      setAppearance,
      accent,
      setAccent,
      animationSpeed,
      setAnimationSpeed,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}

/* ─── Pre-paint ─────────────────────────────────────────────────────────── */

/**
 * Runs before first paint, in `<head>`, so the page never flashes light before
 * a dark-mode user's preference is read. It duplicates a few lines of the store
 * on purpose — nothing else can run this early.
 *
 * Wrapped in try/catch because it runs before React, and an exception here
 * would leave the document un-themed.
 */
const PRE_PAINT_SCRIPT = `
(function(){try{
  var a=localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)})||"system";
  var d=a==="dark"||(a==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
  var r=document.documentElement;
  r.dataset.theme=d?"dark":"light";
  var c=localStorage.getItem(${JSON.stringify(ACCENT_STORAGE_KEY)});
  var m=${JSON.stringify(Object.fromEntries(applePalette.map((color) => [color.value, color.onColor])))};
  if(c&&m[c]){r.style.setProperty("--mac-accent",c);r.style.setProperty("--mac-on-accent",m[c]);}
  var s=Number(localStorage.getItem(${JSON.stringify(ANIMATION_SPEED_STORAGE_KEY)}));
  if(!(s>=.25&&s<=.75))s=.5;
  r.style.setProperty("--topic-motion-duration",(${BASE_TOPIC_MOTION_MS}/s)+"ms");
}catch(e){}})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }} />;
}
