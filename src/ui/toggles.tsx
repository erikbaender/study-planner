"use client";

/**
 * Checkbox, switch, and the unit stepper.
 *
 * Checkbox and Switch are not interchangeable on macOS and are not treated as
 * such here: a checkbox selects, a switch turns something on with immediate
 * effect. Today's blocks get checkboxes; a settings pane gets switches.
 *
 * The stepper is the control Lena touches most — it is how "I did 40 slides"
 * gets into the app — so it takes a little more care than its size suggests.
 */

import { clsx } from "clsx";
import { Checkbox as RadixCheckbox, Switch as RadixSwitch } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { useId, type ReactNode } from "react";

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  className,
}: {
  /** `"indeterminate"` for a partially-complete group, e.g. a course row. */
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={clsx("flex items-start gap-2", className)}>
      <RadixCheckbox.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className={clsx(
          "mt-px grid size-3.5 shrink-0 place-items-center rounded-[3.5px]",
          "bg-content inset-ring inset-ring-[var(--mac-control-border)]",
          "transition-colors duration-100 ease-mac",
          "data-[state=checked]:bg-accent data-[state=checked]:inset-ring-transparent",
          "data-[state=indeterminate]:bg-accent data-[state=indeterminate]:inset-ring-transparent",
          "disabled:opacity-40",
        )}
      >
        <RadixCheckbox.Indicator className="text-on-accent">
          {checked === "indeterminate" ? (
            <Minus className="size-3" strokeWidth={3} />
          ) : (
            <Check className="size-3" strokeWidth={3} />
          )}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className={clsx("text-body select-none", disabled && "opacity-40")}>
          {label}
        </label>
        {hint ? <span className="text-footnote text-secondary">{hint}</span> : null}
      </div>
    </div>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={clsx("flex items-center justify-between gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className={clsx("text-body select-none", disabled && "opacity-40")}>
          {label}
        </label>
        {hint ? <span className="text-footnote text-secondary">{hint}</span> : null}
      </div>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className={clsx(
          "relative h-[15px] w-[26px] shrink-0 rounded-full bg-fill-strong",
          "transition-colors duration-200 ease-mac",
          "data-[state=checked]:bg-accent disabled:opacity-40",
        )}
      >
        <RadixSwitch.Thumb
          className={clsx(
            "block size-[13px] translate-x-px rounded-full bg-white shadow-raised",
            "transition-transform duration-200 ease-mac",
            "data-[state=checked]:translate-x-[12px]",
          )}
        />
      </RadixSwitch.Root>
    </div>
  );
}

/**
 * A number stepper for logging units done.
 *
 * Three deliberate behaviours:
 *
 * - The text field stays free-form while focused and is only clamped on blur,
 *   so typing "1" on the way to "120" is not rewritten to the maximum.
 * - `step` is a *nudge* size (5 slides), while typing accepts any number.
 * - Holding a stepper button does not auto-repeat. Logging progress is not a
 *   scrub gesture, and auto-repeat here mostly produces overshoot.
 */
export function Stepper({
  value,
  onValueChange,
  min = 0,
  max,
  step = 1,
  label,
  suffix,
  disabled,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  /** Unit shown after the field, e.g. "slides". Decorative; not announced. */
  suffix?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const clamp = (next: number) => Math.min(max ?? Infinity, Math.max(min, next));

  return (
    <div className={clsx("inline-flex items-center gap-1.5", className)}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (!Number.isNaN(next)) onValueChange(next);
        }}
        onBlur={(event) => {
          const next = event.currentTarget.valueAsNumber;
          onValueChange(Number.isNaN(next) ? min : clamp(next));
        }}
        className={clsx(
          "h-control-lg w-16 rounded-control bg-content px-2 text-right text-body tabular-nums",
          "inset-ring inset-ring-[var(--mac-control-border)] disabled:opacity-40",
          // The native spin buttons are replaced by the pair below, which match
          // the platform's stacked stepper.
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
      {suffix ? (
        <span aria-hidden="true" className="text-callout text-secondary">
          {suffix}
        </span>
      ) : null}
      <span className="inline-flex flex-col overflow-hidden rounded-[5px] shadow-raised inset-ring inset-ring-[var(--mac-control-border)]">
        <StepperButton
          label={`Increase ${label}`}
          disabled={disabled || (max !== undefined && value >= max)}
          onClick={() => onValueChange(clamp(value + step))}
        >
          <Chevron />
        </StepperButton>
        <span aria-hidden="true" className="h-px bg-[var(--mac-control-border)]" />
        <StepperButton
          label={`Decrease ${label}`}
          disabled={disabled || value <= min}
          onClick={() => onValueChange(clamp(value - step))}
        >
          <Chevron className="rotate-180" />
        </StepperButton>
      </span>
    </div>
  );
}

function StepperButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "flex h-3.5 w-5 items-center justify-center bg-control text-secondary",
        "hover:bg-control-hover active:bg-control-active",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 5" aria-hidden="true" className={clsx("h-[5px] w-2 fill-current", className)}>
      <path d="M4 0 8 5H0z" />
    </svg>
  );
}
