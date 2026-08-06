"use client";

/**
 * The controls that drive `ThemeProvider`.
 *
 * They live in `src/ui` rather than in a settings feature because the appearance
 * switcher is needed from the first phase that renders anything — without it,
 * light mode is once again code that exists but cannot be reached, which is
 * exactly the defect this replaces.
 */

import { Monitor, Moon, Sun } from "lucide-react";
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
