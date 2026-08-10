"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { coursePalette, resolveCourseColorId } from "@/domain";
import { TextArea, TextField } from "@/ui";

/* ─── Shared furniture ──────────────────────────────────────────────────── */

export function Header({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <header className="flex flex-col gap-0.5 px-4 pt-3 pb-2">
      <p className="text-caption font-semibold tracking-wide text-tertiary uppercase">{kind}</p>
      {children}
    </header>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 px-4 py-3">
      {title ? (
        <h3 className="text-caption font-semibold tracking-wide text-tertiary uppercase">
          {title}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

/** A label/value line. The label column is fixed so a stack of them aligns. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-body">
      <span className="w-24 shrink-0 text-secondary">{label}</span>
      <span className="min-w-0 flex-1 tabular-nums">{children}</span>
    </div>
  );
}

/**
 * A text input that commits on blur or Enter and reverts on Escape.
 *
 * Committing on every keystroke would write a repository mutation per character
 * — and on the Convex backend, a round trip per character. Committing only on
 * an explicit Save would mean a field that looks edited but is not, which is
 * the classic inspector bug. Blur-to-commit is what macOS inspectors do.
 */
export function DraftText({
  label,
  value,
  onCommit,
  multiline,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [settled, setSettled] = useState(value);
  // Adjusted during render rather than in an effect, so a value arriving from
  // elsewhere is never painted a frame late. Same pattern as `ProgressSlider`.
  if (settled !== value) {
    setSettled(value);
    setDraft(value);
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === value) return;
    onCommit(trimmed);
  };

  const props = {
    label,
    value: draft,
    placeholder,
    hint,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        // Reverts in place and keeps focus, which is what AppKit does. Blurring
        // here would fire `onBlur` — and `commit` would still be holding this
        // render's draft, so Escape would save the very edit it was discarding.
        setDraft(value);
      } else if (event.key === "Enter" && !multiline) {
        event.preventDefault();
        commit();
      }
    },
  };

  return multiline ? <TextArea rows={3} {...props} /> : <TextField {...props} />;
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selectedColorId = resolveCourseColorId(value);
  return (
    <div className="flex flex-col gap-1">
      {/* Not a `Field`: that wires a `<label for>` to a single control, and
          this is a radiogroup of thirteen. The group's own `aria-label` is what
          names it. */}
      <span className="text-callout font-medium text-secondary">Colour</span>
      <div role="radiogroup" aria-label="Course colour" className="flex flex-wrap gap-1.5 pt-0.5">
        {coursePalette.map((color) => (
          <button
            key={color.id}
            type="button"
            role="radio"
            aria-checked={color.id === selectedColorId}
            aria-label={color.name}
            onClick={() => onChange(color.id)}
            className={clsx(
              "size-5 rounded-full transition-transform duration-100 ease-mac",
              color.id === selectedColorId
                ? "scale-110 inset-ring-2 inset-ring-[var(--mac-label)]"
                : "hover:scale-110",
            )}
            style={{ background: color.value }}
          />
        ))}
      </div>
    </div>
  );
}

