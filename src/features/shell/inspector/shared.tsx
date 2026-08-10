"use client";

import { clsx } from "clsx";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { coursePalette, resolveCourseColorId } from "@/domain";
import {
  IconButton,
  TextArea,
  TextField,
  useReorderAnimation,
  useRowTransitions,
} from "@/ui";

/* ─── Shared furniture ──────────────────────────────────────────────────── */

export function Header({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <header className="flex flex-col gap-0.5 px-4 pt-3 pb-2">
      <p className="text-caption font-semibold tracking-wide text-tertiary uppercase">{kind}</p>
      {children}
    </header>
  );
}

/**
 * Where you are, and one click back to anywhere above it.
 *
 * The inspector describes one entity at a time and the entities nest four deep,
 * so without this the way back from a block to its course is to go and find the
 * course again in whichever view happens to be open. The trail is *not* a
 * history: it is the ancestry of the current selection, so it says the same
 * thing however you arrived.
 */
export type BreadcrumbStep = { id: string; label: string; select: () => void };
export function Breadcrumb({ trail }: { trail: readonly BreadcrumbStep[] }) {
  if (trail.length <= 1) return null;
  return (
    <nav
      aria-label="Selection path"
      className="flex min-w-0 items-center gap-0.5 px-3 pt-2 text-caption text-tertiary"
    >
      {trail.slice(0, -1).map((step) => (
        <span key={step.id} className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            onClick={step.select}
            className="min-w-0 truncate rounded-chip px-1 py-0.5 hover:bg-fill hover:text-secondary"
          >
            {step.label}
          </button>
          <ChevronRight aria-hidden="true" className="size-3 shrink-0" />
        </span>
      ))}
    </nav>
  );
}

/* ─── Reference lists ───────────────────────────────────────────────────── */

/** One row of a `ReferenceList`. Fixed height, because `useRowTransitions` is arithmetic on it. */
export const REFERENCE_ROW_HEIGHT = 26;

export type Reference = {
  id: string;
  label: string;
  /** Right-aligned and secondary: a date range, a count, a size. */
  detail?: string;
  /** The colour dot, where the entity has one. */
  tint?: string;
  selected?: boolean;
};

/**
 * The children of whatever is selected, as rows you can click into.
 *
 * This is what makes the panel a place rather than a form: a semester lists its
 * courses, a course its topics, a topic its blocks, and every row selects that
 * entity — which replaces the panel with the same list one level down. The
 * breadcrumb above is the way back up.
 *
 * Rows arrive and leave on the shared row motion, and swap places on FLIP, so a
 * list here behaves exactly as the chart's lanes do. A block whose dates are
 * dragged in the timeline changes places in the topic's list while you watch.
 */
export function ReferenceList({
  title,
  items,
  empty,
  addLabel,
  onAdd,
  onSelect,
  onDelete,
  deleteLabel,
}: {
  title: string;
  items: readonly Reference[];
  /** Said plainly rather than drawn as an empty box: the list has nothing in it *yet*. */
  empty: string;
  addLabel?: string;
  onAdd?: () => void;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  deleteLabel?: (item: Reference) => string;
}) {
  const rows = useRowTransitions(items, (item) => item.id, REFERENCE_ROW_HEIGHT);
  const listRef = useReorderAnimation<HTMLUListElement>(
    rows.map((row) => row.key),
    REFERENCE_ROW_HEIGHT,
  );

  return (
    <section className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-caption font-semibold tracking-wide text-tertiary uppercase">
          {title}
          {items.length > 0 ? <span className="ml-1.5 tabular-nums">{items.length}</span> : null}
        </h3>
        {onAdd ? (
          <IconButton size="sm" label={addLabel ?? `Add to ${title}`} icon={<Plus />} onClick={onAdd} />
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="py-1 text-body text-secondary">{empty}</p>
      ) : (
        <ul ref={listRef} className="flex flex-col">
          {rows.map(({ key, item, motion }) => (
            <li
              key={key}
              data-row-key={key}
              style={{ height: motion.height, opacity: motion.visible ? 1 : 0 }}
              className="row-motion group/ref relative flex items-center"
            >
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={item.selected ? "true" : undefined}
                className={clsx(
                  "flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-chip px-1.5 text-left text-body",
                  item.selected ? "bg-accent-soft" : "hover:bg-fill",
                )}
              >
                {item.tint ? (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: item.tint }}
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.detail ? (
                  <span className="shrink-0 text-callout tabular-nums text-secondary">
                    {item.detail}
                  </span>
                ) : null}
              </button>
              {onDelete ? (
                // Grows in from the right rather than appearing over the detail,
                // which is the sidebar's pattern and the reason the row's text
                // never has to move out of the way of a control that is not there.
                <span className="flex w-0 shrink-0 items-center overflow-hidden opacity-0 transition-[width,opacity] duration-100 ease-mac pointer-events-none group-hover/ref:w-control group-hover/ref:opacity-100 group-hover/ref:pointer-events-auto group-focus-within/ref:w-control group-focus-within/ref:opacity-100 group-focus-within/ref:pointer-events-auto">
                  <IconButton
                    size="sm"
                    label={deleteLabel?.(item) ?? `Delete ${item.label}`}
                    icon={<Trash2 />}
                    onPointerUp={(event) => event.currentTarget.blur()}
                    onClick={() => onDelete(item.id)}
                  />
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
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

