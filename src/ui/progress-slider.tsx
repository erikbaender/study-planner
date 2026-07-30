"use client";

/**
 * A progress bar you can drag.
 *
 * This replaces the three-control arrangement the topic row used to carry — a
 * read-only bar, a number stepper, and a Log button — with one object that
 * shows the state and *is* the way to change it. The reasoning: for the persona
 * this app is built around, "I got to slide 60" is the whole interaction, and
 * it happens dozens of times a day. Making her read one control, type into a
 * second and click a third to express it was three steps too many.
 *
 * Two things it deliberately keeps from the arrangement it replaces:
 *
 * - **The readout.** The bar shows the shape of the progress; the caller's
 *   label still spells out "60 / 91 slides". A bar alone cannot answer "how
 *   many are left", which is the question that actually gets asked.
 * - **Absolute, not relative.** The slider reports where the topic now *is*.
 *   The caller turns that into a delta for the study log, so velocity keeps
 *   measuring work done per day rather than being overwritten wholesale.
 *
 * Committing is deferred to `onCommit` (pointer release or key up), not fired
 * per pixel — a drag across a 150-slide topic would otherwise write a hundred
 * entries to the log.
 */

import { clsx } from "clsx";
import { Slider } from "radix-ui";
import { useState } from "react";

export function ProgressSlider({
  value,
  max,
  onCommit,
  label,
  valueText,
  tint,
  step = 1,
  disabled,
  className,
}: {
  /** Units completed. */
  value: number;
  /** Units in total. Must be > 0 — an unsized topic has nothing to slide along. */
  max: number;
  /** Fired on release with the new absolute value. */
  onCommit: (value: number) => void;
  /** Announced name, e.g. "Glycolysis progress". */
  label: string;
  /** Announced value, e.g. "60 of 91 slides". Falls back to a percentage. */
  valueText?: (value: number) => string;
  /** Course colour. Defaults to the accent. */
  tint?: string;
  step?: number;
  disabled?: boolean;
  className?: string;
}) {
  /**
   * While the pointer is down the slider is the source of truth; the rest of
   * the time the store is. `draft` holds the former, and is dropped the moment
   * the store reports a different value — without it the bar would snap back to
   * the old position for the frame between release and the repository's answer.
   *
   * Adjusted during render rather than in an effect, which is React's own
   * recommendation for state derived from a changed prop: it costs one extra
   * render pass before paint instead of a visible flash after it.
   */
  const [draft, setDraft] = useState<number | null>(null);
  const [settled, setSettled] = useState(value);
  if (settled !== value) {
    setSettled(value);
    setDraft(null);
  }

  const display = Math.min(max, Math.max(0, draft ?? value));

  return (
    <Slider.Root
      value={[display]}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([next]) => setDraft(next)}
      onValueCommit={([next]) => {
        setDraft(next);
        if (next !== value) onCommit(next);
      }}
      className={clsx(
        // The hit area is taller than the bar it draws. A 6px-tall target is
        // fine for a mouse on a desktop and miserable for everything else.
        //
        // No width of its own, for the same reason `ProgressBar` has none: a
        // `w-full` here would beat a caller's `w-48` (Tailwind orders `w-full`
        // last) and squeeze its row-mates — including the topic's name — to
        // nothing.
        "group relative flex h-5 touch-none items-center select-none",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className,
      )}
    >
      <Slider.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-fill-strong">
        <Slider.Range
          className="absolute h-full rounded-full"
          style={{ background: tint ?? "var(--mac-accent)" }}
        />
      </Slider.Track>
      {/*
        The knob stays hidden until the row is hovered, the slider is focused,
        or a drag is under way. A list of forty topics with forty knobs in it
        reads as a control panel; the same list with forty bars reads as
        progress, which is what it is. The drag case is separate from hover on
        purpose — the pointer often leaves the row vertically mid-drag, and the
        knob disappearing under your own cursor is unnerving.
      */}
      <Slider.Thumb
        // The thumb, not the root, is what carries `role="slider"`, so this is
        // where the name and the spoken value have to live.
        aria-label={label}
        aria-valuetext={valueText ? valueText(display) : `${Math.round((display / max) * 100)}%`}
        className={clsx(
          "block size-3 rounded-full bg-white shadow-raised",
          "inset-ring inset-ring-[var(--mac-control-border)]",
          "transition-opacity duration-100 ease-mac",
          "group-hover:opacity-100 focus-visible:opacity-100",
          draft === null ? "opacity-0" : "opacity-100",
        )}
      />
    </Slider.Root>
  );
}
