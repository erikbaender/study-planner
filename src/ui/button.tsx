"use client";

/**
 * Buttons.
 *
 * macOS has fewer button *kinds* than most design systems and leans on
 * placement instead: a push button in a sheet, a borderless button in a
 * toolbar, one filled button per view to mark the default action. The variants
 * here are exactly those, and nothing else, so "which button do I use" has an
 * obvious answer.
 *
 * Heights come from `--spacing-control` (22px) and `--spacing-control-lg`
 * (28px) rather than padding, which is what lets a row of mixed controls line
 * up on a toolbar without per-control tuning.
 */

import { clsx } from "clsx";
import { Slot } from "radix-ui";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

export type ButtonVariant =
  /** Push button: hairline border on a raised fill. The everyday button. */
  | "push"
  /** The default action of a view. At most one visible at a time. */
  | "accent"
  /** Destructive and irreversible. Filled, so it is never the accidental click. */
  | "danger"
  /** Borderless: toolbars, list rows, anywhere a border would add a box. */
  | "plain";

export type ButtonSize = "sm" | "md";

const BASE = [
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap",
  "rounded-control font-medium select-none",
  "transition-[background-color,box-shadow,opacity] duration-100 ease-mac",
  // A disabled control on macOS fades rather than greying, so it keeps its
  // shape and the layout does not shift when it re-enables.
  "disabled:pointer-events-none disabled:opacity-40",
].join(" ");

const VARIANTS: Record<ButtonVariant, string> = {
  push: clsx(
    "bg-control text-label shadow-raised",
    "inset-ring inset-ring-[var(--mac-control-border)]",
    "hover:bg-control-hover active:bg-control-active",
  ),
  accent: clsx(
    "bg-accent text-on-accent shadow-raised",
    "hover:bg-accent-hover active:bg-accent-hover",
  ),
  danger: clsx("bg-red text-white shadow-raised", "hover:opacity-90 active:opacity-80"),
  plain: clsx("bg-transparent text-label", "hover:bg-fill active:bg-fill-strong"),
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-control px-2.5 text-callout",
  md: "h-control-lg px-3.5 text-body",
};

export function buttonClasses(
  variant: ButtonVariant = "push",
  size: ButtonSize = "md",
  className?: string,
) {
  return clsx(BASE, VARIANTS[variant], SIZES[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Render as the single child element instead of a `<button>`. */
  asChild?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "push",
    size = "md",
    leadingIcon,
    trailingIcon,
    className,
    children,
    asChild,
    // Defaulted because a bare `<button>` inside a form submits it, which has
    // bitten every codebase that did not default it.
    type = "button",
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      ref={ref}
      {...(asChild ? {} : { type })}
      className={buttonClasses(variant, size, className)}
      {...props}
    >
      {leadingIcon ? <Icon>{leadingIcon}</Icon> : null}
      {/* `Slot` needs to be told which child it is slotting onto once icons make
          the children a list rather than a single element. */}
      {asChild ? <Slot.Slottable>{children}</Slot.Slottable> : children}
      {trailingIcon ? <Icon>{trailingIcon}</Icon> : null}
    </Component>
  );
});

function Icon({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="[&_svg]:size-3.5 flex shrink-0 items-center">
      {children}
    </span>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Required: an icon-only control is invisible to a screen reader without it. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "plain", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={clsx(
        BASE,
        VARIANTS[variant],
        // Square, so a row of icon buttons reads as a strip rather than as
        // items of varying width.
        size === "sm" ? "size-control" : "size-control-lg",
        "px-0",
        className,
      )}
      {...props}
    >
      <Icon>{icon}</Icon>
    </button>
  );
});

/**
 * A file picker that looks like a button.
 *
 * `<input type="file">` cannot be styled and cannot be opened programmatically
 * without a user gesture, so the input stays in the DOM, visually hidden, with
 * a `<label>` as its trigger. That also means keyboard and screen-reader users
 * get the real control rather than a simulation of one.
 */
export function FileButton({
  label,
  accept,
  disabled,
  onFile,
  variant = "push",
  size = "md",
}: {
  label: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <label
      className={buttonClasses(
        variant,
        size,
        clsx("cursor-default", disabled && "pointer-events-none opacity-40"),
      )}
    >
      {label}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
          // Cleared so picking the same file twice still fires `change`.
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

/** A row of related buttons, spaced the way a macOS sheet's footer is. */
export function ButtonRow({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={clsx("flex items-center gap-2", className)} {...props} />;
}
