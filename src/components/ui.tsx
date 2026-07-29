"use client";

/**
 * Shared primitives.
 *
 * Ionic is gone: it shipped a full mobile component kit and a competing theme
 * system to render four controls, and `IonModal`'s shadow-DOM animations were
 * the source of the popup-positioning bugs. Phase 2 replaces this file with the
 * macOS-derived component set; until then these are plain elements.
 */

import { clsx } from "clsx";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

type ButtonVariant = "default" | "primary" | "danger" | "invisible" | "unstyled";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  leadingIcon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", leadingIcon, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx("ui-button", `ui-button-${variant}`, className)}
      {...props}
    >
      {leadingIcon ? (
        <span className="ui-button-icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      {children}
    </button>
  );
});

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
};

export function IconButton({
  label,
  icon,
  variant = "default",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={clsx("ui-icon-button", `ui-button-${variant}`, className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {icon}
    </button>
  );
}

export function FileButton({
  label,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className={clsx("ui-button ui-button-default", disabled && "disabled")}>
      {label}
      <input
        className="sr-only"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
          // Cleared so re-picking the same file fires `change` again.
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

type FieldProps = { label: string; hint?: string; error?: string };

function fieldIds(label: string, id: string | undefined, hint?: string, error?: string) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return { fieldId, descriptionId: hint || error ? `${fieldId}-description` : undefined };
}

function FieldHint({ id, hint, error }: { id?: string; hint?: string; error?: string }) {
  if (!hint && !error) return null;
  return (
    <span id={id} className={clsx("ui-field-hint", error && "error")}>
      {error ?? hint}
    </span>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & FieldProps;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, ...props },
  ref,
) {
  const { fieldId, descriptionId } = fieldIds(label, id, hint, error);
  return (
    <label className="ui-field" htmlFor={fieldId}>
      <span className="ui-field-label">{label}</span>
      <input
        ref={ref}
        id={fieldId}
        className="ui-input"
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        {...props}
      />
      <FieldHint id={descriptionId} hint={hint} error={error} />
    </label>
  );
});

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & FieldProps;

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, id, rows = 3, ...props },
  ref,
) {
  const { fieldId, descriptionId } = fieldIds(label, id, hint, error);
  return (
    <label className="ui-field" htmlFor={fieldId}>
      <span className="ui-field-label">{label}</span>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        className="ui-textarea"
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        {...props}
      />
      <FieldHint id={descriptionId} hint={hint} error={error} />
    </label>
  );
});

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> & FieldProps;

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, id, children, ...props },
  ref,
) {
  const { fieldId, descriptionId } = fieldIds(label, id, hint, error);
  return (
    <label className="ui-field" htmlFor={fieldId}>
      <span className="ui-field-label">{label}</span>
      <select
        ref={ref}
        id={fieldId}
        className="ui-input"
        aria-describedby={descriptionId}
        aria-invalid={Boolean(error)}
        {...props}
      >
        {children}
      </select>
      <FieldHint id={descriptionId} hint={hint} error={error} />
    </label>
  );
});

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("ui-panel", className)}>{children}</section>;
}
