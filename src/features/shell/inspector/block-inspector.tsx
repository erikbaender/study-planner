"use client";

/**
 * A study block.
 *
 * Blocks used to have no panel of their own: clicking a bar in the timeline
 * inspected its *topic*, which could say nothing about the one thing the bar
 * actually is — two dates and an intention. So a block that was in the wrong
 * week could only be fixed by dragging it, and a block placed by the scheduler
 * looked exactly like one placed by hand.
 *
 * The two dates are the only fields here that can be wrong in a way the app has
 * to refuse: an end before its start is not a short block, it is not a block.
 * The field reverts rather than writing it.
 */

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { usePlannerRun, useRepository } from "@/data/use-repository";
import {
  addDays,
  courseColorValue,
  rangeLengthInDays,
  UNIT_LABELS,
  type Course,
  type IsoDate,
  type StudyBlock,
  type Topic,
} from "@/domain";
import type { Selection } from "@/features/workspace/store";
import { Badge, Button, Separator, TextField } from "@/ui";
import { Header, Row, Section } from "./shared";

export function BlockInspector({
  course,
  topic,
  block,
  today,
  onSelect,
}: {
  course: Course;
  topic: Topic;
  block: StudyBlock;
  today: IsoDate;
  onSelect: (selection: Selection) => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const unitLabel = UNIT_LABELS[topic.unit].plural;
  const days = rangeLengthInDays(block.startDate, block.endDate);
  const overdue = block.endDate < today && (topic.completedUnits < topic.totalUnits || topic.totalUnits === 0);

  const patch = (changes: Partial<{ startDate: IsoDate; endDate: IsoDate; plannedUnits: number }>) =>
    run(
      repository.updateStudyBlock(block.id, {
        startDate: block.startDate,
        endDate: block.endDate,
        plannedUnits: block.plannedUnits,
        ...changes,
      }),
    );

  return (
    <>
      <Header kind="Study block">
        <h2 className="flex items-center gap-2 text-title3 font-semibold">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: courseColorValue(course.color) }}
          />
          <span className="min-w-0 truncate">{formatSpan(block)}</span>
        </h2>
        <button
          type="button"
          onClick={() => onSelect({ kind: "topic", id: topic.id })}
          className="truncate rounded-chip text-left text-callout text-secondary hover:text-label"
        >
          {topic.name}
        </button>
      </Header>

      <Separator />

      <Section title="When">
        <DateField
          label="Starts"
          value={block.startDate}
          // Moved rather than resized: dragging a bar in the chart moves both
          // ends together, and a start field that silently shortened the block
          // would be the same control doing something else.
          onCommit={(startDate) => patch({ startDate, endDate: shiftEnd(block, startDate) })}
        />
        <DateField
          label="Ends"
          value={block.endDate}
          min={block.startDate}
          onCommit={(endDate) => patch({ endDate })}
        />
        <Row label="Length">
          {days} day{days === 1 ? "" : "s"}
        </Row>
        {overdue ? (
          <Row label="Status">
            <Badge tone="warning">Ended with work left</Badge>
          </Row>
        ) : null}
      </Section>

      <Separator />

      <Section title="Work">
        <TextField
          label={`Planned ${unitLabel}`}
          type="number"
          min={0}
          fieldClassName="w-28"
          hint="What this block is meant to cover. Progress itself is logged on the topic."
          value={String(block.plannedUnits ?? 0)}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next) && next >= 0) patch({ plannedUnits: next });
          }}
        />
        <Row label="Placed">
          {block.source === "manual" ? (
            <Badge tone="neutral">By hand</Badge>
          ) : (
            // Worth stating plainly: reflow regenerates these and leaves manual
            // ones alone, so whether an edit here survives the next reflow
            // depends entirely on this one word.
            <Badge tone="neutral">By the scheduler</Badge>
          )}
        </Row>
        {block.source === "auto" ? (
          <p className="text-callout text-tertiary">
            Reflow may replace this block. Blocks you place by hand are never moved.
          </p>
        ) : null}
      </Section>

      <Separator />

      <Section>
        {/* Straight through, with no confirmation, and the topic selected
            behind it. A block is two dates and one click to make another; the
            chart has always deleted them from its own menu this way, and a
            sheet asking about one here would make the same object feel heavier
            in one place than in another. */}
        <Button
          variant="plain"
          leadingIcon={<Trash2 />}
          className="text-negative"
          onClick={() => {
            run(repository.deleteStudyBlock(block.id));
            onSelect({ kind: "topic", id: topic.id });
          }}
        >
          Delete block
        </Button>
      </Section>
    </>
  );
}

/** Keeps the block's length when its start moves, so "Starts" is a move and not a resize. */
function shiftEnd(block: StudyBlock, startDate: IsoDate): IsoDate {
  return addDays(startDate, rangeLengthInDays(block.startDate, block.endDate) - 1);
}

function formatSpan(block: StudyBlock): string {
  return block.startDate === block.endDate
    ? block.startDate
    : `${block.startDate} – ${block.endDate}`;
}

/**
 * A date that commits on change but refuses to commit an impossible one.
 *
 * `<input type="date">` fires on every keystroke inside the field, including
 * the half-typed years on the way to a real date, so the guard is what stops a
 * block briefly being scheduled in the year 202.
 */
function DateField({
  label,
  value,
  min,
  onCommit,
}: {
  label: string;
  value: IsoDate;
  min?: IsoDate;
  onCommit: (value: IsoDate) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [settled, setSettled] = useState(value);
  if (settled !== value) {
    setSettled(value);
    setDraft(value);
  }

  return (
    <TextField
      label={label}
      type="date"
      min={min}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (/^\d{4}-\d{2}-\d{2}$/.test(next) && (!min || next >= min)) onCommit(next);
      }}
      onBlur={() => setDraft(value)}
    />
  );
}
