"use client";

/**
 * Read-only surfaces: progress, badges, cards, empty states.
 *
 * The one non-obvious piece is `ProgressBar`'s handling of `null`. The domain
 * reports `ratio: null` for a topic with no size, which is *not* the same as
 * 0% — "I haven't said how big this is" versus "I've done none of it". Rendering
 * the first as an empty bar is the sort of quiet lie the plan's fifth product
 * principle rules out, so it gets its own hatched treatment.
 */

import { clsx } from "clsx";
import { Separator as RadixSeparator } from "radix-ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function ProgressBar({
  ratio,
  label,
  tint,
  size = "md",
  className,
}: {
  /** 0–1, or `null` when the total is unknown. */
  ratio: number | null;
  /** Announced value, e.g. "Biochemistry progress". */
  label: string;
  /** Course colour. Defaults to the accent. */
  tint?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const clamped = ratio === null ? null : Math.min(1, Math.max(0, ratio));
  const percent = clamped === null ? null : Math.round(clamped * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      // Omitted rather than zeroed when unknown: an absent `aria-valuenow` is
      // exactly how ARIA spells "indeterminate".
      aria-valuenow={percent ?? undefined}
      aria-valuetext={percent === null ? "Size not set" : `${percent}%`}
      className={clsx(
        // No width of its own: a `w-full` here would beat a caller's `w-28`
        // (Tailwind orders `w-full` last) and squeeze its row-mates to nothing.
        // As a block element it fills its container by default anyway.
        "overflow-hidden rounded-full bg-fill-strong",
        size === "sm" ? "h-1" : "h-1.5",
        className,
      )}
    >
      {clamped === null ? (
        <span
          aria-hidden="true"
          className="block h-full w-full opacity-40"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, currentColor 0 2px, transparent 2px 5px)",
          }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="topic-motion-width block h-full rounded-full"
          style={{ width: `${clamped * 100}%`, background: tint ?? "var(--mac-accent)" }}
        />
      )}
    </div>
  );
}

export type BadgeTone = "neutral" | "accent" | "negative" | "warning" | "positive";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "text-secondary",
  accent: "text-accent",
  negative: "text-negative",
  warning: "text-warning",
  positive: "text-positive",
};

/**
 * A small status chip.
 *
 * Labels are always outlined so they remain visually distinct from buttons.
 * The tone is applied to both the text and border through `currentColor`.
 */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex h-4 shrink-0 items-center gap-1 rounded-chip px-1.5",
        "text-caption font-semibold tabular-nums whitespace-nowrap",
        "border border-current bg-transparent",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A grouped content box — macOS's "box" in a settings pane or inspector. */
export function Card({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={clsx(
        "rounded-card bg-content p-4 shadow-raised",
        "inset-ring inset-ring-[var(--mac-separator)]",
        className,
      )}
      {...props}
    />
  );
}

export function Separator({
  orientation = "horizontal",
  className,
}: {
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <RadixSeparator.Root
      orientation={orientation}
      className={clsx(
        "shrink-0 bg-separator",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}

/**
 * Nothing here, and why.
 *
 * The action is optional, and the three views that empty when the focus does
 * leave it out. A message saying a filter has hidden everything is not a
 * dead end — the sidebar that hid them is still on screen and still holds the
 * way back — so a button offering to *create* something answers a question
 * nobody asked, and puts the loudest control in the app under the quietest
 * moment in it. Where the app really is stuck, as it is with no semester at
 * all, the way out still belongs here.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="text-tertiary [&_svg]:size-8">
          {icon}
        </span>
      ) : null}
      <div className="flex flex-col gap-1">
        <h2 className="text-title3 font-semibold">{title}</h2>
        {description ? (
          <p className="max-w-xs text-body text-secondary">{description}</p>
        ) : null}
      </div>
      {action ?? null}
    </div>
  );
}

export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={clsx(
        "inline-block size-4 animate-spin rounded-full",
        "border-2 border-quaternary border-t-secondary",
        className,
      )}
    />
  );
}
