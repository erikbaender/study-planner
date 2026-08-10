"use client";

/**
 * The pointer, drawn.
 *
 * The hint bar names what each mouse button does *right now*, and a line of
 * prose that begins "left click" spends its first two words saying which button
 * rather than what it does. Blender solves this with a glyph: a mouse with the
 * button in question filled in, then the verb. The shape is small enough to read
 * at caption size and specific enough that the sentence after it can be one
 * word.
 *
 * Drawn rather than taken from the icon set, because no icon set has "a mouse
 * with only the middle button lit".
 */

import { clsx } from "clsx";
import { useId } from "react";

export type PointerButton = "left" | "middle" | "right";

/** A mouse, with `button` filled and the rest as outline. */
export function MouseButtonIcon({
  button,
  className,
}: {
  button: PointerButton;
  className?: string;
}) {
  // The body is a rounded capsule, and the two buttons are the top quadrants of
  // it — so they are drawn as plain rectangles and clipped back to that shape
  // rather than being traced by hand.
  const clip = useId().replace(/:/g, "");

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 14 18"
      className={clsx("h-[1.125rem] w-3.5 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <clipPath id={clip}>
        <rect x="0" y="0" width="14" height="18" rx="7" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {button === "left" ? (
          <rect x="0" y="0" width="6.4" height="7.5" fill="currentColor" stroke="none" />
        ) : null}
        {button === "right" ? (
          <rect x="7.6" y="0" width="6.4" height="7.5" fill="currentColor" stroke="none" />
        ) : null}
      </g>
      <rect x="0.5" y="0.5" width="13" height="17" rx="6.5" />
      <path d="M0.5 7.5 H13.5" />
      <rect
        x="5.6"
        y="2.4"
        width="2.8"
        height="5"
        rx="1.4"
        fill={button === "middle" ? "currentColor" : "var(--mac-material-header, transparent)"}
      />
    </svg>
  );
}

/** The motion mark that turns "the left button" into "the left button, dragged". */
export function DragIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 10 10"
      className={clsx("size-2.5 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.6 3.2 L0.8 5 L2.6 6.8" />
      <path d="M7.4 3.2 L9.2 5 L7.4 6.8" />
      <path d="M0.8 5 H9.2" />
    </svg>
  );
}
