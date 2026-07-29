"use client";

/**
 * Segmented control — the macOS answer to tabs.
 *
 * The plan calls for segmented controls rather than tabs throughout, so this is
 * used for the view switcher, the timeline's zoom levels, and appearance.
 *
 * Built on Radix `ToggleGroup` in single/required mode rather than `Tabs`,
 * because most uses here switch a *value* (zoom = week) rather than a panel,
 * and `Tabs` would demand tabpanel markup that does not exist. Where it does
 * drive panels the caller wires `aria-controls` itself.
 */

import { clsx } from "clsx";
import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";

export type Segment<T extends string> = {
  value: T;
  label: ReactNode;
  /** Used when `label` is an icon, and as the tooltip-less accessible name. */
  ariaLabel?: string;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  segments,
  size = "md",
  label,
  className,
}: {
  value: T;
  onValueChange: (value: T) => void;
  segments: readonly Segment<T>[];
  size?: "sm" | "md";
  /** Names the group for screen readers, e.g. "Zoom level". */
  label: string;
  className?: string;
}) {
  const move = (delta: number) => {
    const enabled = segments.filter((segment) => !segment.disabled);
    const index = enabled.findIndex((segment) => segment.value === value);
    if (index === -1) return;
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    if (next.value !== value) onValueChange(next.value);
  };

  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      // Radix emits "" when the pressed item is re-pressed. A segmented control
      // has no empty state, so that is dropped rather than passed on.
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      // Radix's roving focus moves focus on the arrow keys but leaves selection
      // behind, which is right for a toolbar and wrong for the radio group this
      // reports itself as. Selection is moved alongside it; focus is left to
      // Radix, so the two stay on the same segment.
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") move(1);
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(-1);
      }}
      className={clsx(
        "inline-flex items-center gap-0.5 rounded-control bg-fill p-0.5",
        size === "sm" ? "h-control" : "h-control-lg",
        className,
      )}
    >
      {segments.map((segment) => (
        <ToggleGroup.Item
          key={segment.value}
          value={segment.value}
          disabled={segment.disabled}
          aria-label={segment.ariaLabel}
          className={clsx(
            "inline-flex h-full min-w-[1.75rem] items-center justify-center gap-1.5 rounded-[4px] px-2.5",
            "font-medium whitespace-nowrap select-none",
            size === "sm" ? "text-caption" : "text-callout",
            "transition-[background-color,color,box-shadow] duration-100 ease-mac",
            "text-secondary hover:text-label",
            // The selected segment is a raised thumb sitting in the bed, which
            // is what distinguishes this from a row of pill buttons.
            "data-[state=on]:bg-control data-[state=on]:text-label data-[state=on]:shadow-raised",
            "data-[state=on]:inset-ring data-[state=on]:inset-ring-[var(--mac-control-border)]",
            "disabled:pointer-events-none disabled:opacity-40",
            "[&_svg]:size-3.5",
          )}
        >
          {segment.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
