"use client";

/**
 * The inspector's furniture.
 *
 * The old panel said everything twice: a heading with the topic's name, and
 * then, two sections down, a field labelled "Name" containing the same string.
 * Every kind of thing it described did this, and the result was a column of
 * forms with a summary bolted on top — long enough to scroll, and never obvious
 * which of the two copies you were meant to change.
 *
 * The rule the rebuild follows: **the panel shows each fact exactly once, and
 * where it is shown is where it is edited.** The heading *is* the name field.
 * The dates *are* the date fields. Nothing is stated and then restated as a
 * control, so there is no summary to keep in sync and nothing to scroll past.
 * Fields that look like text until you touch them are what make that possible —
 * the same trick macOS inspectors use, and the reason the panel still reads as
 * a description rather than as a form.
 */

import { clsx } from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { coursePalette, resolveCourseColorId } from "@/domain";
import { TextArea, TextField } from "@/ui";
import { useWorkspace } from "@/features/workspace/store";

/* ─── Shared furniture ──────────────────────────────────────────────────── */

/**
 * The panel's heading, which is also the name field.
 *
 * `entityId` is what makes a freshly created topic land with its name selected:
 * the outline asks for the rename when it creates one, and the request is
 * consumed here so re-selecting the same topic later does not steal focus.
 */
export function InspectorHeader({
  kind,
  entityId,
  name,
  onCommitName,
  accent,
  children,
}: {
  kind: string;
  entityId: string;
  name: string;
  onCommitName: (next: string) => void;
  /** The course colour, shown as a dot beside the name. */
  accent?: string;
  /** A subtitle line: where this thing sits, or how to get to it. */
  children?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRequestId = useWorkspace((state) => state.renameRequestId);
  const setRenameRequest = useWorkspace((state) => state.setRenameRequest);

  useEffect(() => {
    if (renameRequestId !== entityId) return;
    setRenameRequest(null);
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renameRequestId, entityId, setRenameRequest]);

  return (
    <header className="flex flex-col gap-1 px-3 pt-3 pb-2">
      <p className="px-1 text-caption font-semibold tracking-wide text-tertiary uppercase">
        {kind}
      </p>
      <div className="flex items-center gap-2">
        {accent ? (
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: accent }}
          />
        ) : null}
        <InlineText
          inputRef={inputRef}
          label={`${kind} name`}
          value={name}
          onCommit={onCommitName}
          className="text-title3 font-semibold"
        />
      </div>
      {children ? <div className="px-1 text-callout text-secondary">{children}</div> : null}
    </header>
  );
}

/**
 * A field that reads as text and edits as a field.
 *
 * Commits on blur or Enter, reverts on Escape and keeps focus — AppKit's
 * behaviour, and the reason Escape does not also blur is that blurring would
 * fire the commit this render still holds the typed draft for.
 */
export function InlineText({
  label,
  value,
  onCommit,
  placeholder,
  className,
  inputRef,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [draft, setDraft] = useState(value);
  const [settled, setSettled] = useState(value);
  // Adjusted during render, so a value arriving from elsewhere is never painted
  // a frame late. Same pattern as `ProgressSlider`.
  if (settled !== value) {
    setSettled(value);
    setDraft(value);
  }

  return (
    <input
      ref={inputRef}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(value);
        } else if (event.key === "Enter") {
          event.preventDefault();
          if (draft.trim() !== value) onCommit(draft.trim());
        }
      }}
      className={clsx(
        "min-w-0 flex-1 rounded-chip bg-transparent px-1 py-0.5",
        "transition-colors duration-150 ease-mac",
        "hover:bg-fill focus:bg-content focus:text-label",
        "inset-ring-[var(--mac-control-border)] focus:inset-ring",
        className,
      )}
    />
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

/* ─── References ────────────────────────────────────────────────────────── */

/**
 * The other objects this one is made of.
 *
 * A topic's blocks and a course's topics are not properties to be typed into a
 * field; they are things in their own right, with their own place in the app.
 * So they are listed as references: each one says what it is, and clicking it
 * goes there — to the block on the timeline, to the topic in the outline. That
 * is the whole navigation model of the panel, and it is why the inspector never
 * needs to duplicate an editor that already exists somewhere better.
 */
export function ReferenceList({
  label,
  empty,
  children,
}: {
  label: string;
  empty?: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;

  return isEmpty ? (
    <p className="text-body text-tertiary">{empty}</p>
  ) : (
    <ul aria-label={label} className="flex flex-col gap-0.5">
      {items}
    </ul>
  );
}

export function Reference({
  title,
  meta,
  accent,
  selected,
  onSelect,
}: {
  title: string;
  meta?: ReactNode;
  accent?: string;
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={clsx(
          "flex w-full items-center gap-2 rounded-control px-2 py-1 text-left",
          "transition-colors duration-150 ease-mac",
          selected ? "bg-accent-soft" : "hover:bg-fill",
        )}
      >
        {accent ? (
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: accent }}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-body">{title}</span>
        {meta ? (
          <span className="shrink-0 text-callout tabular-nums text-secondary">{meta}</span>
        ) : null}
      </button>
    </li>
  );
}

/* ─── Long text ─────────────────────────────────────────────────────────── */

/**
 * A text area that commits on blur and reverts on Escape.
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
    <div role="radiogroup" aria-label="Course colour" className="flex flex-wrap gap-1.5">
      {coursePalette.map((color) => (
        <button
          key={color.id}
          type="button"
          role="radio"
          aria-checked={color.id === selectedColorId}
          aria-label={color.name}
          onClick={() => onChange(color.id)}
          className={clsx(
            "size-5 rounded-full transition-transform duration-150 ease-mac",
            color.id === selectedColorId
              ? "scale-110 inset-ring-2 inset-ring-[var(--mac-label)]"
              : "hover:scale-110",
          )}
          style={{ background: color.value }}
        />
      ))}
    </div>
  );
}
