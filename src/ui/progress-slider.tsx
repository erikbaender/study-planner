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
import { useEffect, useRef, useState } from "react";

const DEFAULT_PROGRESS_MOTION_MS = 240;

function progressMotionDuration(element: HTMLElement): number {
  const configured = Number.parseFloat(
    getComputedStyle(element).getPropertyValue("--topic-motion-duration"),
  );
  return Number.isFinite(configured) ? configured : DEFAULT_PROGRESS_MOTION_MS;
}

export function ProgressSlider({
  value,
  max,
  onCommit,
  onPreview,
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
  /**
   * Fired continuously while dragging, with the value under the pointer, and
   * with `null` once the store has caught up. Callers use it to keep a readout
   * in step with the bar — a number that only moves on release makes the drag
   * a guess.
   */
  onPreview?: (value: number | null) => void;
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
  const thumbRef = useRef<HTMLSpanElement>(null);
  const pointer = useRef<{ id: number; target: number; dragging: boolean } | null>(null);
  const pendingClickCommit = useRef<number | null>(null);

  const cancelPendingClickCommit = () => {
    if (pendingClickCommit.current === null) return;
    window.clearTimeout(pendingClickCommit.current);
    pendingClickCommit.current = null;
  };

  useEffect(
    () => () => {
      if (pendingClickCommit.current !== null) {
        window.clearTimeout(pendingClickCommit.current);
      }
    },
    [],
  );
  if (settled !== value) {
    setSettled(value);
    setDraft(null);
  }

  const display = Math.min(max, Math.max(0, draft ?? value));

  const pointerTarget = (clientX: number, root: HTMLElement) => {
    const bounds = root.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const raw = ((clientX - bounds.left) / bounds.width) * max;
    return Math.min(max, Math.max(0, Math.round(raw / step) * step));
  };

  const previewPointerTarget = (next: number) => {
    if (pointer.current) pointer.current.target = next;
    setDraft(next);
    onPreview?.(next);
  };

  return (
    <Slider.Root
      value={[display]}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([next]) => {
        cancelPendingClickCommit();
        setDraft(next);
        onPreview?.(next);
      }}
      onValueCommit={([next]) => {
        setDraft(next);
        onPreview?.(next);
        if (next !== value) onCommit(next);
        // Nothing moved, so nothing is in flight and the readout should go back
        // to reading the store rather than waiting for a change that will not
        // arrive.
        else onPreview?.(null);
      }}
      onPointerDownCapture={(event) => {
        // Pointer input is target-based: a click sets one target, while a drag
        // periodically replaces it. The range and thumb interpolate toward
        // each target through CSS instead of being pinned under the cursor.
        if (disabled || event.button !== 0) return;
        const next = pointerTarget(event.clientX, event.currentTarget);
        if (next === null) return;

        event.preventDefault();
        event.stopPropagation();
        cancelPendingClickCommit();
        pointer.current = { id: event.pointerId, target: next, dragging: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        previewPointerTarget(next);
        thumbRef.current?.focus({ preventScroll: true });
      }}
      onPointerMoveCapture={(event) => {
        if (!pointer.current || pointer.current.id !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const next = pointerTarget(event.clientX, event.currentTarget);
        if (next === null || next === pointer.current.target) return;
        pointer.current.dragging = true;
        event.currentTarget.dataset.progressDragging = "true";
        previewPointerTarget(next);
      }}
      onPointerUpCapture={(event) => {
        if (!pointer.current || pointer.current.id !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const wasDragging = pointer.current.dragging;
        const next = pointerTarget(event.clientX, event.currentTarget) ?? pointer.current.target;
        previewPointerTarget(next);
        pointer.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (wasDragging) {
          // React flushes the final draft at the end of this event. Restore
          // click inertia on the following frame so that last drag update is
          // still rendered without a transition.
          const root = event.currentTarget;
          window.requestAnimationFrame(() => {
            delete root.dataset.progressDragging;
          });
        }
        if (next !== value) {
          if (wasDragging) {
            onCommit(next);
          } else {
            // Let the visual click travel finish before persistence can replace
            // the reactive row. Otherwise the new row appears at the endpoint
            // partway through the transition and reads as a hitch.
            pendingClickCommit.current = window.setTimeout(() => {
              pendingClickCommit.current = null;
              onCommit(next);
            }, progressMotionDuration(event.currentTarget));
          }
        } else onPreview?.(null);
      }}
      onPointerCancelCapture={(event) => {
        if (!pointer.current || pointer.current.id !== event.pointerId) return;
        pointer.current = null;
        delete event.currentTarget.dataset.progressDragging;
        setDraft(null);
        onPreview?.(null);
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
          className="topic-progress-range absolute h-full rounded-full"
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
        ref={thumbRef}
        // The thumb, not the root, is what carries `role="slider"`, so this is
        // where the name and the spoken value have to live.
        aria-label={label}
        aria-valuetext={valueText ? valueText(display) : `${Math.round((display / max) * 100)}%`}
        className={clsx(
          "topic-progress-thumb block size-3 rounded-full bg-white shadow-raised",
          "inset-ring inset-ring-[var(--mac-control-border)]",
          "transition-opacity duration-100 ease-mac",
          "group-hover:opacity-100 focus-visible:opacity-100",
          draft === null ? "opacity-0" : "opacity-100",
        )}
      />
    </Slider.Root>
  );
}
