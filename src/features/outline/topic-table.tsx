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
 *
 * A topic's study blocks live one disclosure down from its row rather than
 * only in the timeline or the inspector: the outline is where a whole
 * semester's material is entered, and a block is a fact about that material —
 * moving it to a chart just to see when it falls would send you somewhere
 * else to check the thing you were already looking at.
 */

import { clsx } from "clsx";
import { ChevronRight, PanelRight, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  compareDates,
  courseColorValue,
  UNITS,
  UNIT_LABELS,
  type Course,
  type StudyBlock,
  type Topic,
  type Unit,
} from "@/domain";
import { ContextMenu, IconButton, Select, useDisclosure, useReorderAnimation, useRowTransitions, type RowMotion } from "@/ui";
import { TopicProgressCell } from "@/features/topics/progress-cell";

/** The topic row's own height. Grid rows need a fixed height for `useRowTransitions` to animate them. */
export const TOPIC_ROW_HEIGHT = 28;
/** A block sub-row's height — shorter, since it carries less than a topic row does. */
export const BLOCK_ROW_HEIGHT = 24;

/** Blocks (disclosure) · name · total · unit · readout · progress · done. */
const COLUMNS =
  "grid grid-cols-[2.75rem_minmax(6rem,1fr)_3.5rem_5.5rem_7rem_11rem_1.25rem] items-center gap-3";

const topicKeyOf = (topic: Topic) => topic.id;
const blockKeyOf = (block: StudyBlock) => block.id;

export function TopicTable({
  course,
  topics,
  today,
  selectedId,
  onSelect,
  onSelectBlock,
  onDelete,
  onAddRow,
}: {
  course: Course;
  /** Already filtered by the search field. */
  topics: readonly Topic[];
  today: string;
  selectedId: string | null;
  onSelect: (topic: Topic) => void;
  onSelectBlock: (block: StudyBlock) => void;
  onDelete: (topic: Topic) => void;
  onAddRow: () => void;
}) {
  const rows = useRowTransitions(topics, topicKeyOf, TOPIC_ROW_HEIGHT);
  const rowsRef = useReorderAnimation(
    rows.map((row) => row.key),
    TOPIC_ROW_HEIGHT,
  );

  return (
    <div className="flex flex-col">
      <div
        className={clsx(
          COLUMNS,
          "px-2 pb-1 text-caption font-semibold tracking-wide text-tertiary uppercase",
        )}
      >
        <span />
        <span>Topic</span>
        <span>Total</span>
        <span>Unit</span>
        <span className="text-right">Done</span>
        <span>Progress</span>
        <span />
      </div>

      <ul ref={rowsRef} className="flex flex-col">
        {rows.map(({ key, item: topic, motion }) => (
          <TopicTableRow
            key={key}
            rowKey={key}
            course={course}
            topic={topic}
            today={today}
            selected={topic.id === selectedId}
            motion={motion}
            onSelect={() => onSelect(topic)}
            onSelectBlock={onSelectBlock}
            onDelete={() => onDelete(topic)}
            onAddRow={onAddRow}
          />
        ))}
      </ul>
    </div>
  );
}

function TopicTableRow({
  rowKey,
  course,
  topic,
  today,
  selected,
  motion,
  onSelect,
  onSelectBlock,
  onDelete,
  onAddRow,
}: {
  rowKey: string;
  course: Course;
  topic: Topic;
  today: string;
  selected: boolean;
  /** Where this row is in an arrival or a departure; see `useRowTransitions`. */
  motion: RowMotion;
  onSelect: () => void;
  onSelectBlock: (block: StudyBlock) => void;
  onDelete: () => void;
  onAddRow: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const unit = UNIT_LABELS[topic.unit].plural;
  const [blocksOpen, setBlocksOpen] = useState(false);
  const disclosure = useDisclosure(blocksOpen);
  const sortedBlocks = useMemo(
    () => [...topic.blocks].sort((left, right) => compareDates(left.startDate, right.startDate)),
    [topic.blocks],
  );
  const blockRows = useRowTransitions(sortedBlocks, blockKeyOf, BLOCK_ROW_HEIGHT);
  const blocksHeight =
    blockRows.reduce((total, row) => total + row.motion.height, 0) + BLOCK_ROW_HEIGHT;

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
        unit: topic.unit,
        totalUnits: topic.totalUnits,
        completedUnits: topic.completedUnits,
        notes: topic.notes,
        color: topic.color,
        ...changes,
      }),
    );

  // One day, today, manual: the smallest thing that can then be dragged wider,
  // and the same choice the timeline's lane menu and the topic inspector make.
  const addBlock = () =>
    run(
      repository.createStudyBlock({
        topicId: topic.id,
        startDate: today,
        endDate: today,
        source: "manual",
      }),
    );

  return (
    <ContextMenu
      items={[
        { label: "Show in inspector", icon: <PanelRight />, onSelect },
        { label: "New topic below", icon: <Plus />, onSelect: onAddRow },
        { label: "Add block", icon: <Plus />, onSelect: addBlock },
        { type: "separator" },
        { label: `Delete ${topic.name}`, icon: <Trash2 />, danger: true, onSelect: onDelete },
      ]}
    >
      <li data-row-key={rowKey} className="flex flex-col">
        <div className="row-motion" style={{ height: motion.height, opacity: motion.visible ? 1 : 0 }}>
          <div
            data-course-id={course.id}
            aria-current={selected ? "true" : undefined}
            className={clsx(
              COLUMNS,
              "topic-completion-row group h-full rounded-control px-2",
              selected ? "bg-accent-soft" : "hover:bg-fill",
            )}
            style={{ "--topic-completion-color": courseColorValue(course.color) } as CSSProperties}
          >
            <button
              type="button"
              onClick={() => setBlocksOpen((current) => !current)}
              aria-expanded={blocksOpen}
              aria-label={`${topic.blocks.length} block${topic.blocks.length === 1 ? "" : "s"} for ${topic.name}`}
              className="flex items-center gap-0.5 rounded-chip py-0.5 text-caption text-tertiary hover:bg-fill-strong"
            >
              <ChevronRight
                aria-hidden="true"
                className={clsx(
                  "size-3.5 shrink-0 transition-transform duration-150 ease-mac",
                  blocksOpen && "rotate-90",
                )}
              />
              <span className="tabular-nums">{topic.blocks.length}</span>
            </button>

            <Cell
              label={`Name of ${topic.name}`}
              value={topic.name}
              onCommit={(name) => name && patch({ name })}
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
              tint={courseColorValue(course.color)}
              sliderClassName="w-full min-w-0"
              readoutClassName="text-right text-callout tabular-nums whitespace-nowrap text-secondary"
            />
          </div>
        </div>

        <div className="disclosure" style={{ height: disclosure.expanded ? blocksHeight : 0 }}>
          {disclosure.mounted ? (
            <ul className="flex flex-col">
              {blockRows.map(({ key, item: block, motion }) => (
                <BlockSubRow
                  key={key}
                  block={block}
                  unit={unit}
                  motion={motion}
                  onSelect={() => onSelectBlock(block)}
                  onDelete={() => run(repository.deleteStudyBlock(block.id))}
                />
              ))}
              <li style={{ height: BLOCK_ROW_HEIGHT }}>
                <button
                  type="button"
                  onClick={addBlock}
                  className="flex h-full w-full items-center gap-1.5 rounded-chip pl-8 text-left text-callout text-tertiary hover:bg-fill hover:text-secondary"
                >
                  <Plus aria-hidden="true" className="size-3.5 shrink-0" />
                  Add block
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      </li>
    </ContextMenu>
  );
}

function BlockSubRow({
  block,
  unit,
  motion,
  onSelect,
  onDelete,
}: {
  block: StudyBlock;
  unit: string;
  /** Where this row is in an arrival or a departure; see `useRowTransitions`. */
  motion: RowMotion;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const span = block.startDate === block.endDate ? block.startDate : `${block.startDate} – ${block.endDate}`;

  return (
    <li
      className="row-motion group flex items-center gap-2 pr-2"
      style={{ height: motion.height, opacity: motion.visible ? 1 : 0 }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-chip py-0.5 pl-8 text-left text-callout text-secondary hover:bg-fill hover:text-label"
      >
        <span className="tabular-nums">{span}</span>
        {block.plannedUnits ? (
          <span className="tabular-nums text-tertiary">
            {block.plannedUnits} {unit}
          </span>
        ) : null}
      </button>
      <IconButton
        size="sm"
        label={`Delete the block on ${span}`}
        icon={<Trash2 />}
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      />
    </li>
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
  numeric,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
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
