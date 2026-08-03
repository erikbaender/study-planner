"use client";

/**
 * The controls that drive `ThemeProvider`.
 *
 * They live in `src/ui` rather than in a settings feature because the appearance
 * switcher is needed from the first phase that renders anything — without it,
 * light mode is once again code that exists but cannot be reached, which is
 * exactly the defect this replaces.
 */

import { clsx } from "clsx";
import { Monitor, Moon, Sun } from "lucide-react";
import { useRef } from "react";
import { applePalette } from "@/domain/palette";
import { SegmentedControl } from "./segmented-control";
import { useTheme, type Appearance } from "./theme";

const APPEARANCES = [
  { value: "light", label: <Sun />, ariaLabel: "Light" },
  { value: "dark", label: <Moon />, ariaLabel: "Dark" },
  { value: "system", label: <Monitor />, ariaLabel: "Match system" },
] as const satisfies readonly { value: Appearance; label: React.ReactNode; ariaLabel: string }[];

export function AppearanceControl({ size = "sm" }: { size?: "sm" | "md" }) {
  const { appearance, setAppearance } = useTheme();
  return (
    <SegmentedControl
      label="Appearance"
      size={size}
      value={appearance}
      onValueChange={setAppearance}
      segments={APPEARANCES}
    />
  );
}

export function AnimationSpeedControl() {
  const { animationSpeed, setAnimationSpeed } = useTheme();

  return (
    <label>
      <span className="sr-only">Animation speed</span>
      <input
        type="range"
        min="0.25"
        max="0.75"
        step="0.25"
        value={animationSpeed}
        aria-label="Animation speed"
        onChange={(event) => setAnimationSpeed(Number(event.currentTarget.value))}
        className="block h-4 w-full cursor-pointer accent-[var(--mac-accent)]"
      />
    </label>
  );
}

/**
 * Accent picker.
 *
 * A radiogroup rather than a row of buttons: the swatches are one choice with
 * many options, and the difference is audible — a screen reader announces
 * "Blue, selected, 8 of 13" instead of thirteen unrelated buttons. Arrow keys
 * move between swatches for the same reason.
 */
export function AccentPicker() {
  const { accent, setAccent } = useTheme();
  const group = useRef<HTMLDivElement>(null);

  /** Roving focus: selecting with an arrow key must also move focus there. */
  const move = (delta: number) => {
    const index = applePalette.findIndex((item) => item.value === accent);
    const next = applePalette[(index + delta + applePalette.length) % applePalette.length];
    setAccent(next.value);
    group.current?.querySelector<HTMLButtonElement>(`[data-color="${next.value}"]`)?.focus();
  };

  return (
    <div ref={group} role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-1.5">
      {applePalette.map((color) => {
        const selected = color.value === accent;
        return (
          <button
            key={color.value}
            type="button"
            role="radio"
            data-color={color.value}
            aria-checked={selected}
            aria-label={color.name}
            // Only the selected swatch is in the tab order; arrow keys reach
            // the rest, per the radiogroup pattern.
            tabIndex={selected ? 0 : -1}
            onClick={() => setAccent(color.value)}
            onKeyDown={(event) => {
              const delta =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!delta) return;
              event.preventDefault();
              move(delta);
            }}
            className={clsx(
              "size-5 rounded-full transition-transform duration-100 ease-mac",
              "hover:scale-110",
              selected && "ring-2 ring-label ring-offset-2 ring-offset-[var(--mac-content)]",
            )}
            style={{ background: color.value }}
          />
        );
      })}
    </div>
  );
}
