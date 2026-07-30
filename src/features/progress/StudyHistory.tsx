"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { UNIT_LABELS, type StudyLogEntry, type Topic } from "@/domain";
import type { StudyLogInput } from "@/data/repository";
import { Button, Sheet, TextArea, TextField } from "@/ui";

const UNIT_NUMBER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  signDisplay: "always",
});

export function StudyHistory({
  topic,
  entries,
  today,
  onLogStudy,
}: {
  topic: Topic;
  entries: readonly StudyLogEntry[];
  today: string;
  onLogStudy: (input: StudyLogInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const history = useMemo(
    () =>
      entries
        .filter((entry) => entry.topicId === topic.id)
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, 8),
    [entries, topic.id],
  );
  const unit = UNIT_LABELS[topic.unit];

  return (
    <section className="flex flex-col gap-2" aria-labelledby="study-history-title">
      <div className="flex items-center gap-2">
        <h3 id="study-history-title" className="text-callout font-semibold text-secondary">
          Study history
        </h3>
        <Button
          size="sm"
          variant="plain"
          leadingIcon={<Plus />}
          className="ml-auto"
          onClick={() => setOpen(true)}
        >
          Log progress
        </Button>
      </div>

      {history.length ? (
        <ol className="flex flex-col gap-1.5">
          {history.map((entry) => (
            <li key={entry.id} className="rounded-control bg-fill px-2.5 py-2">
              <div className="flex items-baseline gap-2">
                <time className="text-callout tabular-nums text-secondary" dateTime={entry.date}>
                  {entry.date}
                </time>
                <span className="ml-auto text-body font-semibold tabular-nums">
                  {UNIT_NUMBER.format(entry.units)}{" "}
                  {Math.abs(entry.units) === 1 ? unit.singular : unit.plural}
                </span>
              </div>
              {entry.minutes || entry.note ? (
                <p className="mt-0.5 text-callout whitespace-pre-wrap text-secondary">
                  {entry.minutes ? `${entry.minutes} min${entry.note ? " · " : ""}` : ""}
                  {entry.note ?? ""}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-body text-tertiary">No progress has been logged for this topic.</p>
      )}

      {open ? (
        <LogStudySheet
          topic={topic}
          today={today}
          onClose={() => setOpen(false)}
          onSubmit={(input) => {
            onLogStudy(input);
            setOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function LogStudySheet({
  topic,
  today,
  onClose,
  onSubmit,
}: {
  topic: Topic;
  today: string;
  onClose: () => void;
  onSubmit: (input: StudyLogInput) => void;
}) {
  const [date, setDate] = useState(today);
  const [units, setUnits] = useState("");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const amount = Number(units);
  const duration = minutes ? Number(minutes) : undefined;
  const unit = UNIT_LABELS[topic.unit];
  const unitError =
    units && (!Number.isFinite(amount) || amount <= 0)
      ? "Enter a number greater than zero."
      : undefined;
  const minutesError =
    minutes && (!Number.isFinite(duration) || (duration ?? 0) < 0)
      ? "Minutes cannot be negative."
      : undefined;
  const disabled = !date || !units || Boolean(unitError || minutesError);

  const submit = () => {
    if (disabled) return;
    onSubmit({
      topicId: topic.id,
      date,
      units: amount,
      minutes: duration,
      note: note.trim() || undefined,
    });
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Log progress for ${topic.name}`}
      description={`Record completed ${unit.plural}. This history drives velocity and finish projections.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={disabled} onClick={submit}>
            Log progress
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <TextField
            autoFocus
            label={sentenceCase(unit.plural)}
            type="number"
            min="0.1"
            step="any"
            value={units}
            error={unitError}
            onChange={(event) => setUnits(event.target.value)}
          />
        </div>
        <TextField
          label="Minutes"
          type="number"
          min="0"
          step="1"
          value={minutes}
          error={minutesError}
          hint="Optional"
          onChange={(event) => setMinutes(event.target.value)}
        />
        <TextArea
          label="Note"
          value={note}
          hint="Optional context, such as the exercise or lecture covered."
          onChange={(event) => setNote(event.target.value)}
        />
      </form>
    </Sheet>
  );
}

function sentenceCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
