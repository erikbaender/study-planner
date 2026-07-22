"use client";

import { createAnimation, IonModal } from "@ionic/react";
import { clsx } from "clsx";
import { X } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

type ButtonVariant = "default" | "primary" | "danger" | "invisible" | "unstyled";

function popupEnterAnimation(baseElement: HTMLElement) {
  const backdrop = createAnimation()
    .addElement(baseElement.querySelector("ion-backdrop")!)
    .fromTo("opacity", "0.01", "var(--backdrop-opacity)");
  const content = createAnimation()
    .addElement(baseElement.querySelector(".modal-wrapper")!)
    .fromTo("opacity", "0", "1")
    .fromTo("transform", "translateY(28px)", "translateY(0)");

  return createAnimation().addElement(baseElement).duration(180).easing("cubic-bezier(0.2, 0, 0, 1)").addAnimation([backdrop, content]);
}

function popupLeaveAnimation(baseElement: HTMLElement) {
  const backdrop = createAnimation()
    .addElement(baseElement.querySelector("ion-backdrop")!)
    .fromTo("opacity", "var(--backdrop-opacity)", "0");
  const content = createAnimation()
    .addElement(baseElement.querySelector(".modal-wrapper")!)
    .fromTo("opacity", "1", "0")
    .fromTo("transform", "translateY(0)", "translateY(-28px)");

  return createAnimation().addElement(baseElement).duration(140).easing("cubic-bezier(0.4, 0, 1, 1)").addAnimation([backdrop, content]);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  leadingIcon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", leadingIcon, className, children, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={clsx("ui-button", `ui-button-${variant}`, className)} {...props}>
      {leadingIcon ? <span className="ui-button-icon" aria-hidden="true">{leadingIcon}</span> : null}
      {children}
    </button>
  );
});

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
};

export function IconButton({ label, icon, variant = "default", className, type = "button", ...props }: IconButtonProps) {
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

export function FileIconButton({
  label,
  icon,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  icon: ReactNode;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <label className={clsx("ui-icon-button ui-button-default", disabled && "disabled")} title={label} aria-disabled={disabled}>
      {icon}
      <input
        className="sr-only"
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onFile(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  hint?: string;
  error?: string;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, id, ...props },
  ref,
) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const descriptionId = hint || error ? `${fieldId}-description` : undefined;

  return (
    <label className="ui-field" htmlFor={fieldId}>
      <span className="ui-field-label">{label}</span>
      <input ref={ref} id={fieldId} className="ui-input" aria-describedby={descriptionId} aria-invalid={Boolean(error)} {...props} />
      {hint || error ? <span id={descriptionId} className={clsx("ui-field-hint", error && "error")}>{error ?? hint}</span> : null}
    </label>
  );
});

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & {
  label: string;
  hint?: string;
  error?: string;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, id, rows = 3, ...props },
  ref,
) {
  const fieldId = id ?? `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const descriptionId = hint || error ? `${fieldId}-description` : undefined;

  return (
    <label className="ui-field" htmlFor={fieldId}>
      <span className="ui-field-label">{label}</span>
      <textarea ref={ref} id={fieldId} rows={rows} className="ui-textarea" aria-describedby={descriptionId} aria-invalid={Boolean(error)} {...props} />
      {hint || error ? <span id={descriptionId} className={clsx("ui-field-hint", error && "error")}>{error ?? hint}</span> : null}
    </label>
  );
});

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  icon,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <IonModal isOpen={open} onDidDismiss={onClose} className="ui-dialog-modal" enterAnimation={popupEnterAnimation} leaveAnimation={popupLeaveAnimation}>
      <div className="ui-dialog" role="document">
        <header className="ui-dialog-header">
          {icon ? <span className="ui-dialog-icon" aria-hidden="true">{icon}</span> : null}
          <h2 className="ui-dialog-title">{title}</h2>
          <IconButton label="Close dialog" icon={<X size={16} />} variant="invisible" className="ui-dialog-close" onClick={onClose} />
        </header>
        <div className="ui-dialog-body">{children}</div>
        <footer className="ui-dialog-footer">{footer}</footer>
      </div>
    </IonModal>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("ui-panel", className)}>{children}</section>;
}