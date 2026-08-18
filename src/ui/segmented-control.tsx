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
import { useLayoutEffect, useRef, type ReactNode } from "react";

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
  "aria-controls": ariaControls,
}: {
  value: T;
  onValueChange: (value: T) => void;
  segments: readonly Segment<T>[];
  size?: "sm" | "md";
  /** Names the group for screen readers, e.g. "Zoom level". */
  label: string;
  className?: string;
  /** The region this control switches, when it drives one. */
  "aria-controls"?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  /**
   * The selection slides — but only once it has somewhere to slide from.
   *
   * macOS moves the thumb of a segmented control between segments; fading one
   * segment's fill out while another fades in loses the thing the motion is
   * for, which is showing *which way* the value moved. Measured from the live
   * item rather than computed from an index, because the segments are as wide
   * as their labels.
   *
   * The *first* placement is not a move and must not look like one. Measuring
   * the selected segment forces the browser to compute the styles the control
   * was inserted with — thumb at the left edge, no width — so the placement
   * that follows reads as a change from those, and every control in a view or
   * an inspector that had just arrived slid in from its own left edge while the
   * panel around it was still fading. Applying that first placement with the
   * transition off makes it the start value instead, which is what "the thumb
   * is simply there" means in CSS.
   */
  useLayoutEffect(() => {
    const root = rootRef.current;
    const thumb = thumbRef.current;
    const selected = root?.querySelector<HTMLElement>('[data-state="on"]');
    if (!root || !thumb || !selected) return;

    const width = selected.offsetWidth;
    const arriving = !placed.current;
    if (arriving) thumb.style.transition = "none";

    thumb.style.width = `${width}px`;
    thumb.style.transform = `translateX(${selected.offsetLeft - root.clientLeft}px)`;
    thumb.style.opacity = "1";

    if (arriving) {
      // Flushed before the transition is handed back, so the position just set
      // is the one the next change animates away from.
      void thumb.offsetWidth;
      thumb.style.transition = "";
      // A control measured at zero has not been laid out yet — a panel still
      // opening, a view not yet in the document. That is not a placement to
      // animate away from, so the next run settles instead of sliding.
      placed.current = width > 0;
    }
  }, [value, segments, size]);

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
      aria-controls={ariaControls}
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
      ref={rootRef}
      className={clsx(
        "relative inline-flex items-center gap-0.5 rounded-control bg-fill p-0.5",
        size === "sm" ? "h-control" : "h-control-lg",
        className,
      )}
    >
      {/* Behind the labels, not around them: one thumb that travels, rather
          than a fill that belongs to whichever segment currently owns it. */}
      <span
        ref={thumbRef}
        aria-hidden="true"
        className="segmented-thumb pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-[4px] bg-accent opacity-0 shadow-raised"
      />
      {segments.map((segment) => (
        <ToggleGroup.Item
          key={segment.value}
          value={segment.value}
          disabled={segment.disabled}
          aria-label={segment.ariaLabel}
          className={clsx(
            "relative z-10 inline-flex h-full min-w-[1.75rem] items-center justify-center gap-1.5 rounded-[4px] px-2.5",
            "font-medium whitespace-nowrap select-none",
            size === "sm" ? "text-caption" : "text-callout",
            "segmented-item text-secondary hover:text-label",
            // The selected segment is the one the thumb is under; only its
            // label changes colour, so the fill itself can travel.
            "data-[state=on]:text-on-accent",
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
