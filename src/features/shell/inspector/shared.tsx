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
 * The rule the panel follows: **each fact appears exactly once, where it is
 * edited.** There is no panel title naming the kind of object either: the
 * inspector only ever describes the thing that is selected, and a line of text
 * saying "Topic" above a topic is a label for the panel rather than for
 * anything in it.
 *
 * A **section** is the panel's unit of layout, and it is one object: exactly one
 * label, one block of controls, the same padding on every side, and a rule
 * between it and the next one. Two labelled groups of controls are two
 * sections — see the context-menu and inspector rules in `AGENTS.md`.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { TextArea, TextField } from "@/ui";
import { useWorkspace } from "@/features/workspace/store";

/* ─── Shared furniture ──────────────────────────────────────────────────── */

/**
 * The object's name, in an ordinary text field.
 *
 * It used to be a borderless input that only looked like a field once you had
 * found it with the pointer. The panel is an editor; its most-edited control
 * should look like a control, with the same height and padding as every other
 * field in the app.
 */
export function NameSection({
  kind,
  entityId,
  name,
  onCommit,
}: {
  kind: string;
  entityId: string;
  name: string;
  onCommit: (next: string) => void;
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
    <Section title="Name">
      <DraftText inputRef={inputRef} label={`${kind} name`} hideLabel value={name} onCommit={onCommit} />
    </Section>
  );
}

/**
 * `action` is what the section can be *given*, and it sits on the label's own
 * row — the same arrangement the sidebar and the course card use, so adding a
 * study block looks like adding a topic or an exam rather than like a button
 * that happens to be the last thing in the section.
 */
export function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 p-4">
      {title ? (
        <header className="flex h-6 items-center gap-1">
          <h3 className="text-caption font-semibold tracking-wide text-tertiary uppercase">
            {title}
          </h3>
          {action ? <span className="ml-auto">{action}</span> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** A label/value line. The label column is fixed so a stack of them aligns. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-body">
      <span className="w-24 shrink-0 text-secondary">{label}</span>
      <span className="min-w-0 flex-1 break-words tabular-nums">{children}</span>
    </div>
  );
}

/* ─── References ────────────────────────────────────────────────────────── */

/**
 * The other objects this one is made of.
 *
 * A course's topics are not properties to be typed into a field; they are
 * things in their own right, with their own place in the app. So they are
 * listed as references: each one says what it is, and clicking it goes there —
 * to the topic in the outline. Study blocks are the deliberate exception:
 * their dates are small, local adjustments, so the topic inspector edits them
 * in place while still offering the timeline as the richer view.
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
  hideLabel,
  inputRef,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  multiline?: boolean;
  placeholder?: string;
  hint?: string;
  hideLabel?: boolean;
  /** Lets a rename request from elsewhere put the caret in this field. */
  inputRef?: React.RefObject<HTMLInputElement | null>;
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
    hideLabel,
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

  return multiline ? <TextArea rows={3} {...props} /> : <TextField ref={inputRef} {...props} />;
}
