"use client";

/**
 * Text fields, text areas and pop-up buttons.
 *
 * Every control here is wrapped by `Field`, which owns the label/description
 * wiring: a generated id, `aria-describedby` pointing at the hint *or* the
 * error, and `aria-invalid`. Doing that once means a new field cannot ship
 * without it, which is how the old implementation ended up with inputs whose
 * only label was placeholder text.
 *
 * Layout follows macOS: labels sit above the control in a sheet and to the left
 * in a settings pane. `orientation` picks between the two rather than each
 * caller re-nesting divs.
 */

import { clsx } from "clsx";
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

const CONTROL = clsx(
  "w-full rounded-control bg-content text-label text-body",
  "inset-ring inset-ring-[var(--mac-control-border)]",
  "placeholder:text-tertiary",
  "transition-shadow duration-100 ease-mac",
  "disabled:opacity-40",
  // Invalid state is a red ring, not red text: the message below already says
  // what is wrong, and red text on a 13px label fails contrast in dark mode.
  "aria-invalid:inset-ring-[var(--mac-red)]",
);

type FieldShellProps = {
  label: ReactNode;
  /** Steady-state help. Replaced by `error` when one is present. */
  hint?: ReactNode;
  error?: ReactNode;
  orientation?: "vertical" | "horizontal";
  /** Hides the label visually but keeps it for screen readers. */
  hideLabel?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

export function Field({
  label,
  hint,
  error,
  orientation = "vertical",
  hideLabel,
  className,
  children,
}: FieldShellProps) {
  const id = useId();
  const describedBy = hint || error ? `${id}-description` : undefined;

  return (
    <div
      className={clsx(
        orientation === "vertical" ? "flex flex-col gap-1" : "grid grid-cols-[8rem_1fr] gap-x-3 items-baseline",
        className,
      )}
    >
      <label
        htmlFor={id}
        className={clsx(
          "text-callout font-medium text-secondary",
          orientation === "horizontal" && "justify-self-end text-right",
          hideLabel && "sr-only",
        )}
      >
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint || error ? (
        <p
          id={describedBy}
          // The live region matters: a validation message that appears after
          // submit is otherwise silent for a screen-reader user.
          role={error ? "alert" : undefined}
          className={clsx(
            "text-footnote",
            error ? "text-red" : "text-secondary",
            orientation === "horizontal" && "col-start-2",
          )}
        >
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = Pick<FieldShellProps, "label" | "hint" | "error" | "orientation" | "hideLabel"> & {
  fieldClassName?: string;
};

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & Common;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, orientation, hideLabel, fieldClassName, className, ...props },
  ref,
) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      orientation={orientation}
      hideLabel={hideLabel}
      className={fieldClassName}
    >
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={clsx(CONTROL, "h-control-lg px-2", className)}
          {...props}
        />
      )}
    </Field>
  );
});

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & Common;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, orientation, hideLabel, fieldClassName, className, rows = 3, ...props },
  ref,
) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      orientation={orientation}
      hideLabel={hideLabel}
      className={fieldClassName}
    >
      {({ id, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={clsx(CONTROL, "resize-y px-2 py-1.5", className)}
          {...props}
        />
      )}
    </Field>
  );
});

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & Common;

/**
 * A native `<select>`, styled as a macOS pop-up button.
 *
 * Radix's Select is used elsewhere for menus that need rich rows, but a plain
 * list of options is one case where the native control is strictly better: it
 * gets the platform's own picker on touch devices, type-ahead for free, and it
 * cannot be clipped by an overflow container.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, orientation, hideLabel, fieldClassName, className, children, ...props },
  ref,
) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      orientation={orientation}
      hideLabel={hideLabel}
      className={fieldClassName}
    >
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <select
            ref={ref}
            id={id}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className={clsx(
              CONTROL,
              "h-control-lg appearance-none bg-control pr-7 pl-2",
              "hover:bg-control-hover",
              className,
            )}
            {...props}
          >
            {children}
          </select>
          {/* The chevron pair macOS uses for pop-up buttons, drawn rather than
              iconified so it scales with the control and never mis-centres. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2 flex flex-col justify-center gap-[3px] text-secondary"
          >
            <Chevron className="rotate-180" />
            <Chevron />
          </span>
        </div>
      )}
    </Field>
  );
});

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 5" className={clsx("h-[5px] w-2 fill-current", className)}>
      <path d="M4 5 0 0h8z" />
    </svg>
  );
}
