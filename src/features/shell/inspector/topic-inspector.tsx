"use client";

/**
 * The topic inspector — the only inspector there is.
 *
 * Courses are edited where they live, in the outline; the panel describes the
 * selected topic and nothing else, which is why it has no title naming its own
 * kind. Every group of controls below is a `Section`: one label, one rule
 * between it and the next, the same padding on all four sides.
 */

import { Crosshair, Plus, Trash2 } from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";
import { usePlannerState, usePlannerRun, useRepository } from "@/data/use-repository";
import {
  addDays,
  courseColorValue,
  differenceInDays,
  UNITS,
  UNIT_LABELS,
  PRIORITIES,
  minutesPerUnit,
  type Course,
  type StudyBlock,
  type Topic,
  type Priority,
  type Unit,
} from "@/domain";
import {
  Button,
  Checkbox,
  ContextMenu,
  IconButton,
  ProgressBar,
  ProgressSlider,
  SegmentedControl,
  Select,
  Separator,
  Stepper,
  TextField,
} from "@/ui";
import { CompletionCheckbox, triggerCompletionAnimation } from "@/features/topics/progress-cell";
import { clampToLimits, limitsFor } from "@/features/timeline/blocks";
import { sortCoursesAlphabetically } from "@/features/workspace/scope";
import { StudySessionSheet } from "@/features/history/study-session-sheet";
import { DraftText, NameSection, Section } from "./shared";

/* ─── Topic ─────────────────────────────────────────────────────────────── */

export function TopicInspector({
  course,
  courses,
  topic,
  today,
  onRevealBlock,
  onDelete,
}: {
  course: Course;
  courses: readonly Course[];
  topic: Topic;
  today: string;
  onRevealBlock: (block: StudyBlock) => void;
  onDelete: () => void;
}) {
  const repository = useRepository();
  const run = usePlannerRun();
  const state = usePlannerState();
  const [session, setSession] = useState<"new" | string | null>(null);
  const logs = state.status === "ready" ? state.snapshot.studyLog.filter(entry => entry.topicId === topic.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const unitLabel = UNIT_LABELS[topic.unit].plural;
  const dependencyCandidates = course.topics.filter((candidate) => candidate.id !== topic.id);
  const [preview, setPreview] = useState<number | null>(null);
  const [settled, setSettled] = useState(topic.completedUnits);
  const completionCheckboxRef = useRef<HTMLInputElement>(null);

  // A preview only bridges the time between an interaction and the repository
  // publishing its result. Once stored progress changes — whether from this
  // panel or from an outline row — the repository is authoritative again.
  if (settled !== topic.completedUnits) {
    setSettled(topic.completedUnits);
    setPreview(null);
  }

  const shown = preview ?? topic.completedUnits;
  const tint = courseColorValue(course.color);

  /**
   * Every edit sends the whole topic back, because `updateTopic` takes a
   * complete patch. `completedUnits` is therefore passed through *unchanged* on
   * purpose and is never in `changes` — progress moves through `logStudy` and
   * nowhere else, so that velocity always has a record behind it.
   */
  const patch = (
    changes: Partial<{
      name: string;
      unit: Unit;
      totalUnits: number;
      minutesPerUnit: number;
      priority: Priority;
      notes: string;
      color: string;
    }>,
  ) =>
    run(
      repository.updateTopic(topic.id, {
        name: topic.name,
        unit: topic.unit,
        totalUnits: topic.totalUnits,
        minutesPerUnit: topic.minutesPerUnit,
        completedUnits: topic.completedUnits,
        status: topic.status,
        priority: topic.priority,
        notes: topic.notes,
        color: topic.color,
        ...changes,
      }),
    );

  const logTo = (units: number, from = topic.completedUnits) => {
    setPreview(units);
    run(repository.logStudy({ topicId: topic.id, date: today, units: units - from }));
  };

  const blocks = [...topic.blocks].sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) || left.id.localeCompare(right.id),
  );

  return (
    <>
      <NameSection
        kind="Topic"
        entityId={topic.id}
        name={topic.name}
        onCommit={(name) => name ? patch({ name }) : undefined}
      />

      <Separator />

      <Section title="Course">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ background: tint }}
          />
          <Select
            aria-label={`Course for ${topic.name}`}
            value={course.id}
            onValueChange={(courseId) => {
              if (courseId !== course.id) run(repository.moveTopic(topic.id, courseId));
            }}
            className="min-w-0 flex-1 text-body"
            options={sortCoursesAlphabetically(courses).map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
            }))}
          />
        </div>
      </Section>

      <Separator />

      <Section title="Progress">
        <div
          className="topic-completion-row group flex items-center gap-3 rounded-control px-2 py-1"
          data-course-id={course.id}
          style={{ "--topic-completion-color": tint } as CSSProperties}
        >
          {topic.totalUnits > 0 ? (
            <ProgressSlider
              className="min-w-0 flex-1"
              value={topic.completedUnits}
              max={topic.totalUnits}
              label={`${topic.name} progress`}
              valueText={(units) => `${units} of ${topic.totalUnits} ${unitLabel}`}
              tint={tint}
              onPreview={(units) => {
                if (units !== null && units >= topic.totalUnits && shown < topic.totalUnits) {
                  triggerCompletionAnimation(completionCheckboxRef.current, "slider");
                } else if (units !== null && units < topic.totalUnits && shown >= topic.totalUnits) {
                  triggerCompletionAnimation(completionCheckboxRef.current, "slider", false);
                }
                setPreview(units);
              }}
              onCommit={(units) => logTo(units)}
            />
          ) : (
            <ProgressBar className="min-w-0 flex-1" ratio={0} label={`${topic.name} progress`} />
          )}
          <CompletionCheckbox
            inputRef={completionCheckboxRef}
            topicId={topic.id}
            topicName={topic.name}
            checked={topic.totalUnits > 0 && shown >= topic.totalUnits}
            disabled={topic.totalUnits === 0}
            onChange={(checked) => logTo(checked ? topic.totalUnits : 0, shown)}
          />
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2 px-2 text-body">
          <span className="min-w-0 truncate tabular-nums text-secondary">
            {shown} / {topic.totalUnits} {unitLabel}
          </span>
        </div>

        <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 px-2">
          <span className="text-callout text-secondary">Total</span>
          <div className="flex min-w-0 items-center gap-2">
            <Stepper
              label={`Total ${unitLabel} in ${topic.name}`}
              commitOnBlur
              min={0}
              value={topic.totalUnits}
              onValueChange={(totalUnits) => patch({ totalUnits })}
            />
            <Select
              aria-label={`Unit for ${topic.name}`}
              value={topic.unit}
              onValueChange={(unit) => patch({ unit: unit as Unit })}
              className="min-w-0 flex-1 text-callout text-secondary"
              options={UNITS.map((candidate) => ({
                value: candidate,
                label: UNIT_LABELS[candidate].plural,
              }))}
            />
          </div>
        </div>

        {topic.totalUnits === 0 ? (
          <p className="text-callout text-tertiary">
            Give this topic a size and the bar becomes draggable — that is also what lets the app
            work out whether the course will be finished in time.
          </p>
        ) : null}
      </Section>

      <Separator />

      <Section title="Study sessions" action={<IconButton size="sm" label="Log study session" icon={<Plus />} onClick={() => setSession("new")} />}>
        {logs.length ? <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto">{logs.slice(0, 20).map(entry => <li key={entry.id}>
          <Button size="sm" variant="plain" onClick={() => setSession(entry.id)}>{entry.date} · {entry.units} {unitLabel}{entry.minutes === undefined ? "" : ` · ${entry.minutes} min`}</Button>
          {entry.note ? <p className="break-words px-2 text-callout text-secondary">{entry.note}</p> : null}
        </li>)}</ul> : <p className="text-callout text-tertiary">No sessions recorded. Log a date, duration, and note, or correct earlier progress.</p>}
      </Section>
      <Separator />
      {session ? <StudySessionSheet key={session} topic={topic} today={today} entry={logs.find(entry => entry.id === session)} onClose={() => setSession(null)} /> : null}
      <Section title="Time estimate">
        <Stepper label={`Minutes per ${UNIT_LABELS[topic.unit].singular} in ${topic.name}`}
          commitOnBlur
          value={minutesPerUnit(topic)} min={0.01} max={10080} step={0.5}
          onValueChange={(minutesPerUnit) => patch({ minutesPerUnit })} />
        <p className="text-callout text-tertiary">{topic.minutesPerUnit === undefined ? "Starting estimate. " : "Your estimate. "}Estimated remaining time: {Math.ceil(Math.max(0, topic.totalUnits - topic.completedUnits) * minutesPerUnit(topic))} minutes. Reflow applies changes to the schedule.</p>
      </Section>
      <Separator />
      {/* Auto-planning owns generated workload; manual sessions can set theirs. */}
      <Section
        title="Scheduled"
        action={
          <IconButton
            size="sm"
            label={`Add a study block to ${topic.name}`}
            icon={<Plus />}
            onClick={() => {
              const lastBlock = [...topic.blocks]
                .sort((left, right) => left.endDate.localeCompare(right.endDate))
                .at(-1);
              const startDate = lastBlock ? addDays(lastBlock.endDate, 1) : today;
              run(
                repository.createStudyBlock({
                  topicId: topic.id,
                  startDate,
                  endDate: startDate,
                  source: "manual",
                }),
              );
            }}
          />
        }
      >
        {blocks.length === 0 ? (
          <p className="text-body text-tertiary">Not scheduled yet</p>
        ) : (
          <ul aria-label={`Study blocks for ${topic.name}`} className="flex flex-col gap-1.5">
            {blocks.map((block, index) => (
          <StudyBlockRow
                key={block.id}
                block={block}
                labelled={index === 0}
                topic={topic}
                onReveal={() => onRevealBlock(block)}
                onUpdate={(next) => run(repository.updateStudyBlock(block.id, next))}
                onRemove={() => run(repository.deleteStudyBlock(block.id))}
              />
            ))}
          </ul>
        )}
      </Section>

      <Separator />

      <Section title="Priority">
        <SegmentedControl
          size="sm"
          label={`Priority of ${topic.name}`}
          className="w-full min-w-0 [&>button]:flex-1"
          value={topic.priority}
          onValueChange={(priority) => patch({ priority })}
          segments={PRIORITIES.map((priority) => ({
            value: priority,
            label: priority[0].toUpperCase() + priority.slice(1),
          }))}
        />
      </Section>

      <Separator />

      <Section title="Dependencies">
        {dependencyCandidates.length === 0 ? (
          <span className="text-body text-tertiary">No other topics in this course</span>
        ) : (
          <div className="flex max-h-32 min-w-0 flex-col gap-1 overflow-y-auto rounded-control bg-fill p-2">
            {dependencyCandidates.map((candidate) => {
              const checked = topic.dependencyIds.includes(candidate.id);
              return (
                <Checkbox
                  key={candidate.id}
                  className="min-w-0"
                  label={<span className="min-w-0 break-words">{candidate.name}</span>}
                  checked={checked}
                  onCheckedChange={() =>
                    run(
                      repository.setTopicDependencies(
                        topic.id,
                        checked
                          ? topic.dependencyIds.filter((id) => id !== candidate.id)
                          : [...topic.dependencyIds, candidate.id],
                      ),
                    )
                  }
                />
              );
            })}
          </div>
        )}
      </Section>

      <Separator />

      <Section title="Notes">
        <DraftText
          label="Notes"
          hideLabel
          value={topic.notes}
          multiline
          placeholder="Lecture numbers, which book, what to skip"
          onCommit={(notes) => patch({ notes })}
        />
      </Section>

      <Separator />

      <Section>
        <Button variant="danger" leadingIcon={<Trash2 />} className="self-start" onClick={onDelete}>
          Delete
        </Button>
      </Section>
    </>
  );
}

/**
 * One scheduled window: a start date and an end date, side by side.
 *
 * Both fields are live — there is no disclosure to open first, because a row
 * that only shows a date range you cannot touch is a label pretending to be a
 * control. `clampToLimits` keeps the repository's ordered-date invariant while
 * a date field is mid-edit and briefly reporting an earlier day.
 */
function StudyBlockRow({
  block,
  topic,
  labelled,
  onReveal,
  onUpdate,
  onRemove,
}: {
  block: StudyBlock;
  topic: Topic;
  /** Only the first row carries visible column labels; the rest inherit them. */
  labelled: boolean;
  onReveal: () => void;
  onUpdate: (patch: { startDate: string; endDate: string; plannedUnits?: number }) => void;
  onRemove: () => void;
}) {
  const moveStart = (startDate: string) => {
    if (!startDate) return;
    const delta = differenceInDays(block.startDate, startDate);
    const next = clampToLimits(
      { startDate, endDate: addDays(block.endDate, delta) },
      "move",
      limitsFor(block, topic),
    );
    onUpdate({ ...next, plannedUnits: block.plannedUnits });
  };

  const resizeEnd = (endDate: string) => {
    if (!endDate) return;
    const next = clampToLimits(
      {
        startDate: block.startDate,
        endDate: endDate < block.startDate ? block.startDate : endDate,
      },
      "end",
      limitsFor(block, topic),
    );
    onUpdate({ ...next, plannedUnits: block.plannedUnits });
  };

  return (
    <ContextMenu
      items={[
        { label: "Focus in timeline", icon: <Crosshair />, onSelect: onReveal },
        { type: "separator" },
        { label: "Delete", icon: <Trash2 />, danger: true, onSelect: onRemove },
      ]}
    >
      <li className="flex min-w-0 flex-col gap-2 rounded-control">
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <TextField
            label="Starts"
            hideLabel={!labelled}
            type="date"
            value={block.startDate}
            fieldClassName="min-w-0"
            className="min-w-0 px-1.5 text-callout"
            onChange={(event) => moveStart(event.target.value)}
          />
          <TextField
            label="Ends"
            hideLabel={!labelled}
            type="date"
            value={block.endDate}
            fieldClassName="min-w-0"
            className="min-w-0 px-1.5 text-callout"
            onChange={(event) => resizeEnd(event.target.value)}
          />
        </div>
        {block.source === "manual" ? (
          <div className="flex min-w-0 flex-col gap-1 px-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="text-callout text-secondary">Planned {UNIT_LABELS[topic.unit].plural}</span>
              <Stepper
                label={`Planned ${UNIT_LABELS[topic.unit].plural} for ${topic.name} on ${block.startDate}`}
                commitOnBlur
                value={block.plannedUnits ?? 0}
                min={0}
                step={1}
                suffix={UNIT_LABELS[topic.unit].plural}
                onValueChange={(plannedUnits) => onUpdate({
                  startDate: block.startDate,
                  endDate: block.endDate,
                  plannedUnits,
                })}
              />
            </div>
            <p className="text-footnote text-tertiary">
              {topic.totalUnits === 0
                ? block.plannedUnits
                  ? `Reserves ${block.plannedUnits} ${block.plannedUnits === 1 ? UNIT_LABELS[topic.unit].singular : UNIT_LABELS[topic.unit].plural}; the topic has no size, so this adds no topic units.`
                  : "No workload entered: reserves a full study day and adds no topic units."
                : block.plannedUnits
                  ? `Counts ${block.plannedUnits} ${block.plannedUnits === 1 ? UNIT_LABELS[topic.unit].singular : UNIT_LABELS[topic.unit].plural} toward this topic (${Math.ceil(block.plannedUnits * minutesPerUnit(topic))} estimated minutes).`
                  : "No workload entered: reserves a full study day and covers no topic units."}
            </p>
          </div>
        ) : null}
      </li>
    </ContextMenu>
  );
}
