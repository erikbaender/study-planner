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
import { Check, ChevronDown } from "lucide-react";
import { Select as RadixSelect } from "radix-ui";
import {
  useId,
  forwardRef, type InputHTMLAttributes,
  type ReactNode,
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

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

type SelectProps = {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  className?: string;
};

/** A menu-backed picker whose surface and rows match the app's context menus. */
export function Select({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder,
  disabled,
  id,
  className,
  ...aria
}: SelectProps) {
  return (
    <RadixSelect.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        className={clsx(
          CONTROL,
          "flex h-control-lg items-center justify-between bg-control px-2 text-left",
          "hover:bg-control-hover data-[state=open]:bg-control-hover",
          className,
        )}
        {...aria}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon asChild>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-secondary" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={12}
          className={clsx(
            "material-popover z-50 min-w-44 rounded-control p-1 shadow-popover",
            "inset-ring inset-ring-[var(--mac-separator-strong)]",
            "origin-(--radix-select-content-transform-origin)",
            "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
          )}
        >
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={clsx(
                  "relative flex h-6 cursor-default items-center rounded-[4px] py-0 pr-7 pl-2 text-body select-none",
                  "outline-none data-highlighted:bg-accent data-highlighted:text-on-accent",
                  "data-disabled:pointer-events-none data-disabled:opacity-40",
                )}
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2">
                  <Check className="size-3" strokeWidth={3} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

type SelectFieldProps = SelectProps & Common;

export function SelectField({
  label, hint, error, orientation, hideLabel, fieldClassName, className, ...props
}: SelectFieldProps) {
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
        <Select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={className}
          {...props}
        />
      )}
    </Field>
  );
}
