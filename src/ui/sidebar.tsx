"use client";

/**
 * The source list — macOS's sidebar.
 *
 * A source list is a *navigation* control, not a list of buttons, so it is
 * marked up as one: a `<nav>` containing a list, with the current row carrying
 * `aria-current="page"`. That is what lets a screen-reader user jump to it and
 * hear where they are, which the previous implementation's plain `div`s could
 * not do.
 *
 * `SidebarItem` takes the course dot, progress and exam countdown as structured
 * props rather than children, because those three are the row — letting callers
 * compose freely is how sidebars drift into five different row layouts.
 */

import { clsx } from "clsx";
import { AlertTriangle } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Badge, ProgressBar } from "./feedback";

export function Sidebar({
  children,
  label = "Sidebar",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={clsx(
        "material-sidebar flex w-60 shrink-0 flex-col gap-4 overflow-y-auto px-2 py-3",
        "border-r border-separator",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export function SidebarSection({
  title,
  action,
  children,
}: {
  title?: string;
  /** Usually a `+` icon button, shown at the section header. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5">
      {title ? (
        <header className="flex h-6 items-center gap-1 px-2">
          <h2 className="text-caption font-semibold tracking-wide text-tertiary uppercase">
            {title}
          </h2>
          {action ? <span className="ml-auto">{action}</span> : null}
        </header>
      ) : null}
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

/**
 * A row in the source list.
 *
 * The `<li>` takes any extra props and forwards its ref so that Radix's
 * `asChild` can make the whole row a context-menu trigger. Attaching the menu
 * to an inner wrapper instead would mean right-clicking the row's padding — the
 * majority of its area — did nothing.
 */
export const SidebarItem = forwardRef<
  HTMLLIElement,
  {
    label: string;
    selected?: boolean;
    onSelect: () => void;
    icon?: ReactNode;
    /** Course colour, drawn as the leading dot. */
    dotColor?: string;
    /** Trailing count, e.g. how many topics are behind. */
    count?: number;
    /** Exam countdown. Outlined when the exam date is provisional. */
    badge?: ReactNode;
    /** 0–1, or `null` when the course has no measured topics. */
    progress?: number | null;
    className?: string;
  } & Omit<ComponentPropsWithoutRef<"li">, "onSelect" | "className">
>(function SidebarItem(
  { label, selected, onSelect, icon, dotColor, count, badge, progress, className, ...rest },
  ref,
) {
  return (
    <li ref={ref} {...rest}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "page" : undefined}
        className={clsx(
          "group flex w-full flex-col gap-1 rounded-control px-2 py-1 text-left select-none",
          "transition-colors duration-100 ease-mac",
          selected
            ? // Selected rows use the accent at full strength with white text;
              // this is the one place the sidebar is not translucent, and it is
              // how macOS marks the current source.
              "bg-accent text-on-accent"
            : "text-label hover:bg-fill",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {dotColor ? (
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: dotColor }}
            />
          ) : null}
          {icon ? (
            <span
              aria-hidden="true"
              className={clsx("shrink-0 [&_svg]:size-3.5", !selected && "text-secondary")}
            >
              {icon}
            </span>
          ) : null}
          <span className="truncate text-body">{label}</span>
          {count !== undefined && count > 0 ? (
            <span
              className={clsx(
                "ml-auto shrink-0 text-callout tabular-nums",
                selected ? "opacity-80" : "text-tertiary",
              )}
            >
              {count}
            </span>
          ) : null}
          {badge ? <span className="ml-auto shrink-0">{badge}</span> : null}
        </span>
        {progress !== undefined ? (
          <ProgressBar
            ratio={progress}
            label={`${label} progress`}
            size="sm"
            // On a selected row the accent fill would vanish into the accent
            // background, so it inverts to the row's foreground.
            tint={selected ? "var(--mac-on-accent)" : dotColor}
            className={selected ? "bg-white/25" : undefined}
          />
        ) : null}
      </button>
    </li>
  );
});

/**
 * The exam countdown badge. Provisional dates are outlined, confirmed ones
 * filled — the visual half of "never lie about certainty".
 */
export function CountdownBadge({
  days,
  provisional,
  atRisk,
}: {
  days: number;
  provisional?: boolean;
  /** The course will not be finished in time. Shown, and said, rather than left to the colour. */
  atRisk?: boolean;
}) {
  // At risk overrides the distance: an exam six weeks away that you will not be
  // ready for is the more urgent fact, and "6w" in grey says the opposite.
  const tone = atRisk ? "red" : days <= 3 ? "red" : days <= 10 ? "orange" : "neutral";
  return (
    <Badge tone={tone}>
      <span className="sr-only">
        {provisional ? "Provisional exam, " : "Exam in "}
        {days} days
        {atRisk ? ", not on track" : ""}
      </span>
      {atRisk ? (
        <AlertTriangle aria-hidden="true" className="size-2.5" strokeWidth={3} />
      ) : null}
      <span aria-hidden="true">{days}d</span>
    </Badge>
  );
}
