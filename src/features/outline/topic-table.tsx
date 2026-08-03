"use client";

/**
 * The outline table.
 *
 * §7.3 calls the outline the setup workhorse — where four hundred topics get
 * entered and then worked through. That makes it a table, not a list, and the
 * fields have to be editable where they are read. Opening an inspector to
 * correct one slide count is fine once; it is not fine forty times in a row.
 *
 * The cells look like text until you touch them. A grid of four hundred visible
 * input boxes reads as a form to be filled in, which is the opposite of what
 * this is: material you already have, being kept up to date. macOS tables —
 * Finder's list view, Xcode's build settings — do the same thing.
 *
 * Rows are a CSS grid with the column widths declared once, so the header and
 * every row stay in the same columns without a `<table>`'s layout quirks.
 */

import { clsx } from "clsx";
import { useState, type CSSProperties } from "react";
import { usePlannerErrors, useRepository } from "@/data/use-repository";
import { UNITS, UNIT_LABELS, type Course, type Topic, type Unit } from "@/domain";
import { ContextMenu, Select } from "@/ui";
import { TopicProgressCell } from "@/features/topics/progress-cell";

/** Name · total · unit · readout · progress · done. */
const COLUMNS =
  "grid grid-cols-[minmax(6rem,1fr)_3.5rem_5.5rem_7rem_11rem_1.25rem] items-center gap-3";

export function TopicTable({
  course,
  topics,
  today,
  selectedId,
  onSelect,
  onDelete,
  onAddRow,
}: {
  course: Course;
  /** Already filtered by the search field; the section headers follow whatever survives. */
  topics: readonly Topic[];
  today: string;
  selectedId: string | null;
  onSelect: (topic: Topic) => void;
  onDelete: (topic: Topic) => void;
  onAddRow: (afterSection: string | undefined) => void;
}) {
  return (
    <div className="flex flex-col">
      <div
        className={clsx(
          COLUMNS,
          "px-2 pb-1 text-caption font-semibold tracking-wide text-tertiary uppercase",
        )}
      >
        <span>Topic</span>
        <span>Total</span>
        <span>Unit</span>
        <span className="text-right">Done</span>
        <span>Progress</span>
        <span />
      </div>

      <ul className="flex flex-col">
        {groupBySection(topics).map(([section, rows]) => (
          <li key={section ?? "__none"}>
            {section ? (
              <h3 className="px-2 pt-2 pb-0.5 text-callout font-semibold text-secondary">
                {section}
              </h3>
            ) : null}
            <ul className="flex flex-col">
              {rows.map((topic) => (
                <TopicTableRow
                  key={topic.id}
                  course={course}
                  topic={topic}
                  today={today}
                  selected={topic.id === selectedId}
                  onSelect={() => onSelect(topic)}
                  onDelete={() => onDelete(topic)}
                  onAddRow={() => onAddRow(topic.section)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopicTableRow({
  course,
  topic,
  today,
  selected,
  onSelect,
  onDelete,
  onAddRow,
}: {
  course: Course;
  topic: Topic;
  today: string;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onAddRow: () => void;
}) {
  const repository = useRepository();
  const { run } = usePlannerErrors();
  const unit = UNIT_LABELS[topic.unit].plural;

  /**
   * `updateTopic` takes a whole topic, so every edit resends the lot.
   * `completedUnits` is passed through unchanged and is never in `changes`:
   * progress moves through `logStudy` and nowhere else, so that velocity always
   * has a record behind the number.
   */
  const patch = (changes: Partial<{ name: string; unit: Unit; totalUnits: number }>) =>
    run(
      repository.updateTopic(topic.id, {
        name: topic.name,
        section: topic.section,
        unit: topic.unit,
        totalUnits: topic.totalUnits,
        completedUnits: topic.completedUnits,
        status: topic.status,
        priority: topic.priority,
        notes: topic.notes,
        color: topic.color,
        ...changes,
      }),
    );

  return (
    <ContextMenu
      items={[
        { label: "Show in inspector", onSelect },
        { label: "New topic below", shortcut: "⌘⏎", onSelect: onAddRow },
        { type: "separator" },
        { label: `Delete ${topic.name}`, danger: true, onSelect: onDelete },
      ]}
    >
      <li
        data-course-id={course.id}
        // Deliberately *not* selecting on focus. It used to, and dragging the
        // progress bar therefore opened the inspector mid-drag, which narrowed
        // the content column, which moved the bar out from under the pointer.
        // Selection is an explicit act: the name, the ⋯ menu, or right-click.
        className={clsx(
          COLUMNS,
          "topic-completion-row group rounded-control px-2 py-0.5",
          selected ? "bg-accent-soft" : "hover:bg-fill",
        )}
        style={{ "--topic-completion-color": course.color } as CSSProperties}
      >
        <Cell
          label={`Name of ${topic.name}`}
          value={topic.name}
          onCommit={(name) => name && patch({ name })}
          onAddRow={onAddRow}
        />

        <span className="flex items-baseline gap-1">
          <Cell
            label={`Total ${unit} in ${topic.name}`}
            value={String(topic.totalUnits)}
            numeric
            onCommit={(next) => {
              const total = Number(next);
              if (Number.isFinite(total) && total >= 0 && total !== topic.totalUnits) {
                patch({ totalUnits: total });
              }
            }}
            onAddRow={onAddRow}
          />
        </span>

        <Select
          aria-label={`Unit for ${topic.name}`}
          value={topic.unit}
          onValueChange={(unit) => patch({ unit: unit as Unit })}
          className={clsx(
            "-mx-1 h-6 w-full rounded-chip bg-transparent px-1",
            "text-callout text-secondary",
            "hover:bg-fill-strong focus:bg-content focus:text-label",
          )}
          options={UNITS.map((candidate) => ({ value: candidate, label: UNIT_LABELS[candidate].plural }))}
        />

        <TopicProgressCell
          topic={topic}
          today={today}
          tint={course.color}
          sliderClassName="w-full min-w-0"
          readoutClassName="text-right text-callout tabular-nums whitespace-nowrap text-secondary"
        />
      </li>
    </ContextMenu>
  );
}

/**
 * A cell that reads as text and edits as a field.
 *
 * Commits on blur or Enter, reverts on Escape and keeps focus — AppKit's
 * behaviour, and the reason Escape does not also blur is that blurring would
 * fire the commit this render still holds the typed draft for.
 *
 * Tab is left alone. The fields are in DOM order, so the browser's own
 * tab-through walks the table the way §7.3 asks for, and every key we do not
 * take is one less thing that can disagree with the platform.
 */
function Cell({
  label,
  value,
  onCommit,
  onAddRow,
  numeric,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  onAddRow: () => void;
  numeric?: boolean;
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
      aria-label={label}
      value={draft}
      inputMode={numeric ? "numeric" : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(value);
        } else if (event.key === "Enter") {
          event.preventDefault();
          // ⌘⏎ is "another one like this" — the gesture you want after typing a
          // row, and the one §7.3 asks for. Plain Enter just commits.
          if (event.metaKey || event.ctrlKey) onAddRow();
          if (draft.trim() !== value) onCommit(draft.trim());
        }
      }}
      className={clsx(
        "-mx-1 h-6 min-w-0 rounded-chip bg-transparent px-1 text-body",
        numeric ? "w-10 text-left tabular-nums" : "w-full truncate",
        "hover:bg-fill-strong focus:bg-content focus:text-label",
        "inset-ring-[var(--mac-control-border)] focus:inset-ring",
      )}
    />
  );
}

/** Groups consecutive rows by section, preserving the order the topics arrive in. */
function groupBySection(topics: readonly Topic[]): Array<[string | undefined, Topic[]]> {
  const groups: Array<[string | undefined, Topic[]]> = [];
  for (const topic of topics) {
    const last = groups.at(-1);
    if (last && last[0] === topic.section) last[1].push(topic);
    else groups.push([topic.section, [topic]]);
  }
  return groups;
}
